import type { Round } from '@kancil-quiz/games-sdk';

export type PairRound = Extract<Round, { shape: 'pair' }>;

export interface MatchPage {
    // 左側：題目依宿主給的順序排列
    slots: PairRound[];
    // 右側：同一頁的答案卡片，另外打亂
    cards: PairRound[];
}

// 某一刻的分頁：refit() 試過幾種組數後要回到原本的分頁時用（見 sameLayout()、restore()）
export interface MatchLayout {
    pages: readonly MatchPage[];
    pageIndex: number;
}

export interface PlaceResult {
    entryId: string; // 放到哪一題（左側）
    selected: string; // 放上去的卡片（右側，以 entryId 識別）
    correct: boolean;
    firstTry: boolean; // 這一題的第一次作答，成績以它為準（docs/SPEC.md 7.4）
    presented: string[]; // 這一頁出現的所有卡片
    pageComplete: boolean;
}

// 畫面放不下老師設定的組數時，每頁最少還是這麼多組（老師能設定的下限也是 3）
export const MIN_PAIRS_PER_PAGE = 3;

// 老師設定的是每頁「最多」幾組（docs/SPEC.md 7.5）。從上限往下找第一個放得下的組數：
// fits 由畫面實際量測；都放不下就用下限，剩下的交給捲動。最後一次呼叫 fits 的參數就是回傳值。
export function fitPairsPerPage(
    max: number,
    fits: (perPage: number) => boolean,
): number {
    for (let perPage = max; ; perPage--) {
        const ok = fits(perPage);
        if (ok || perPage <= MIN_PAIRS_PER_PAGE) {
            return perPage;
        }
    }
}

// 把 count 題分成每頁不超過 perPage 題，各頁題數盡量平均（例如 7 題、每頁 6 題 → 4、3）。
export function pageSizes(count: number, perPage: number): number[] {
    if (count <= 0) {
        return [];
    }
    const pages = Math.ceil(count / Math.max(1, perPage));
    const base = Math.floor(count / pages);
    const extra = count % pages;
    return Array.from({ length: pages }, (_, i) => base + (i < extra ? 1 : 0));
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

// 依 sizes 把題目切成幾頁，每頁的卡片另外打亂
function splitPages(
    rounds: readonly PairRound[],
    sizes: readonly number[],
    rng: () => number,
): MatchPage[] {
    let start = 0;
    return sizes.map((size) => {
        const slots = rounds.slice(start, start + size);
        start += size;
        return { slots, cards: shuffled(slots, rng) };
    });
}

function sameSlots(a: readonly MatchPage[], b: readonly MatchPage[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (page, i) =>
                page.slots.length === b[i].slots.length &&
                page.slots.every(
                    (slot, j) => slot.entryId === b[i].slots[j].entryId,
                ),
        )
    );
}

// 配對的進行狀態，不碰 DOM，方便測試。放錯的卡片退回，可以再放；每題以第一次放上去的卡片計分。
export class MatchSession {
    private pageList: MatchPage[];
    pageIndex = 0;
    score = 0;
    private readonly matched = new Set<string>();
    private readonly tried = new Set<string>();

    constructor(
        rounds: readonly PairRound[],
        perPage: number,
        rng: () => number,
    ) {
        this.pageList = splitPages(
            rounds,
            pageSizes(rounds.length, perPage),
            rng,
        );
    }

    get pages(): readonly MatchPage[] {
        return this.pageList;
    }

    get page(): MatchPage | undefined {
        return this.pageList[this.pageIndex];
    }

    get finished(): boolean {
        return this.pageIndex >= this.pageList.length;
    }

    get pageComplete(): boolean {
        return (
            this.page?.slots.every((slot) => this.matched.has(slot.entryId)) ??
            false
        );
    }

    isMatched(entryId: string): boolean {
        return this.matched.has(entryId);
    }

    // 把卡片放到某一題。卡片或題目不在這一頁、或已經配好時不算作答，回傳 null。
    place(cardId: string, slotId: string): PlaceResult | null {
        const page = this.page;
        if (
            !page ||
            !page.cards.some((card) => card.entryId === cardId) ||
            !page.slots.some((slot) => slot.entryId === slotId) ||
            this.matched.has(cardId) ||
            this.matched.has(slotId)
        ) {
            return null;
        }

        // 配對的正解就是同一個詞條的右側（docs/SPEC.md 7.4）
        const correct = cardId === slotId;
        const firstTry = !this.tried.has(slotId);
        this.tried.add(slotId);
        if (correct) {
            this.matched.add(slotId);
            if (firstTry) {
                this.score++;
            }
        }

        return {
            entryId: slotId,
            selected: cardId,
            correct,
            firstTry,
            presented: page.cards.map((card) => card.entryId),
            pageComplete: this.pageComplete,
        };
    }

    nextPage(): void {
        if (this.pageComplete) {
            this.pageIndex++;
        }
    }

    // 畫面大小改變後（轉向、調整視窗）依新的每頁組數重新分頁，進度照舊：
    // - 已經配完的頁不動；配好的題目仍然算配好、只算一次，分數與作答紀錄都不變。
    // - 這一頁配好的留在這一頁；還沒配的（這一頁剩下的，接著後面幾頁的）依原本的順序排在後面，
    //   連同配好的一起用 pageSizes() 平均分頁。
    // - 這一頁配好的已經佔滿新的第一頁時（例如直向配好 4 組才轉成橫放、一頁只放 3 組），
    //   這一頁就算配完、直接換到下一頁，還沒配的另外平均分頁。
    // 分頁沒有改變時什麼都不動（卡片的順序也不變），回傳 false。
    refit(perPage: number, rng: () => number): boolean {
        const page = this.page;
        if (!page) {
            return false;
        }
        const matchedHere = page.slots.filter((slot) =>
            this.matched.has(slot.entryId),
        );
        const rest = [
            ...page.slots.filter((slot) => !this.matched.has(slot.entryId)),
            ...this.pageList
                .slice(this.pageIndex + 1)
                .flatMap((later) => later.slots),
        ];
        if (rest.length === 0) {
            return false;
        }

        const sizes = pageSizes(matchedHere.length + rest.length, perPage);
        let pageIndex = this.pageIndex;
        let pages: MatchPage[];
        if (matchedHere.length < sizes[0]) {
            const fill = sizes[0] - matchedHere.length;
            const slots = [...matchedHere, ...rest.slice(0, fill)];
            pages = [
                { slots, cards: shuffled(slots, rng) },
                ...splitPages(rest.slice(fill), sizes.slice(1), rng),
            ];
        } else {
            pages = [
                {
                    slots: matchedHere,
                    cards: page.cards.filter((card) =>
                        this.matched.has(card.entryId),
                    ),
                },
                ...splitPages(rest, pageSizes(rest.length, perPage), rng),
            ];
            pageIndex++;
        }

        const next = [...this.pageList.slice(0, this.pageIndex), ...pages];
        if (pageIndex === this.pageIndex && sameSlots(this.pageList, next)) {
            return false;
        }
        this.pageList = next;
        this.pageIndex = pageIndex;
        return true;
    }

    get layout(): MatchLayout {
        return { pages: this.pageList, pageIndex: this.pageIndex };
    }

    // 分頁是不是和 layout 一樣（哪一頁、每頁哪些題目；卡片的順序不比）
    sameLayout(layout: MatchLayout): boolean {
        return (
            this.pageIndex === layout.pageIndex &&
            sameSlots(this.pageList, layout.pages)
        );
    }

    // 回到之前的分頁。只能在 refit() 之後、還沒有放過卡片時用：中間放過卡片的話，
    // 那次作答的 presented 就不是這份分頁的卡片了
    restore(layout: MatchLayout): void {
        this.pageList = [...layout.pages];
        this.pageIndex = layout.pageIndex;
    }
}

export function pairRounds(rounds: Round[]): PairRound[] {
    return rounds.filter((round): round is PairRound => round.shape === 'pair');
}
