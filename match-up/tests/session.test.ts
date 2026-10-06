import { buildRounds, check, createRng, judge } from '@kancil-quiz/deck';
import type { Round } from '@kancil-quiz/games-sdk';
import type { KancilSet } from '@kancil-quiz/schema';
import { describe, expect, it } from 'vite-plus/test';
import { meta } from '../src/meta';
import {
    MIN_PAIRS_PER_PAGE,
    MatchSession,
    fitPairsPerPage,
    pageSizes,
    pairRounds,
} from '../src/session';

// 共用的 fixture 在平台的 packages/schema；以 / 開頭是從平台的根目錄算起，這個 repo 掛在哪一層都找得到
const fixtures = import.meta.glob<KancilSet>(
    '/packages/schema/fixtures/sets/*/set.json',
    { eager: true, import: 'default' },
);

function pair(entryId: string): Extract<Round, { shape: 'pair' }> {
    return {
        shape: 'pair',
        entryId,
        left: { text: `左 ${entryId}` },
        right: { text: `右 ${entryId}` },
    };
}

const rng = () => createRng(7);

describe('pageSizes()', () => {
    it.each([
        [6, 6, [6]],
        [7, 6, [4, 3]],
        [8, 6, [4, 4]],
        [13, 6, [5, 4, 4]],
        [23, 6, [6, 6, 6, 5]],
        [2, 3, [2]],
        [0, 6, []],
    ])('%i 題、每頁最多 %i 組', (count, perPage, expected) => {
        expect(pageSizes(count, perPage)).toEqual(expected);
    });
});

describe('fitPairsPerPage()', () => {
    it('畫面放得下就用老師設定的組數', () => {
        const tried: number[] = [];
        expect(
            fitPairsPerPage(6, (perPage) => {
                tried.push(perPage);
                return true;
            }),
        ).toBe(6);
        expect(tried).toEqual([6]);
    });

    it('放不下就逐步減少，最後一次量的就是採用的組數', () => {
        const tried: number[] = [];
        expect(
            fitPairsPerPage(6, (perPage) => {
                tried.push(perPage);
                return perPage <= 4;
            }),
        ).toBe(4);
        expect(tried).toEqual([6, 5, 4]);
    });

    it('都放不下時用下限，不再往下減', () => {
        const tried: number[] = [];
        expect(
            fitPairsPerPage(5, (perPage) => (tried.push(perPage), false)),
        ).toBe(MIN_PAIRS_PER_PAGE);
        expect(tried).toEqual([5, 4, 3]);
    });

    it('上限本來就不超過下限時只量一次', () => {
        const tried: number[] = [];
        expect(
            fitPairsPerPage(3, (perPage) => (tried.push(perPage), false)),
        ).toBe(3);
        expect(tried).toEqual([3]);
    });
});

describe('MatchSession', () => {
    const rounds = ['a', 'b', 'c', 'd', 'e'].map(pair);

    it('分頁時每頁的卡片就是同一頁的題目，順序另外打亂', () => {
        const session = new MatchSession(rounds, 3, rng());
        expect(session.pages.map((page) => page.slots.length)).toEqual([3, 2]);
        for (const page of session.pages) {
            expect(page.cards.map((c) => c.entryId).sort()).toEqual(
                page.slots.map((s) => s.entryId).sort(),
            );
        }
    });

    it('放錯可以再放，每題以第一次放的卡片計分', () => {
        const session = new MatchSession(rounds.slice(0, 3), 6, rng());

        expect(session.place('b', 'a')).toEqual({
            entryId: 'a',
            selected: 'b',
            correct: false,
            firstTry: true,
            presented: session.page?.cards.map((c) => c.entryId),
            pageComplete: false,
        });
        expect(session.place('a', 'a')).toMatchObject({
            correct: true,
            firstTry: false,
        });
        expect(session.place('b', 'b')).toMatchObject({
            correct: true,
            firstTry: true,
        });
        expect(session.place('c', 'c')).toMatchObject({
            correct: true,
            pageComplete: true,
        });
        expect(session.score).toBe(2);

        session.nextPage();
        expect(session.finished).toBe(true);
    });

    it('配好的題目與卡片不能再放；不在這一頁的不算作答', () => {
        const session = new MatchSession(rounds, 3, rng());
        const [first, second] = session.page?.slots ?? [];
        const later = session.pages[1].slots[0].entryId;

        session.place(first.entryId, first.entryId);
        expect(session.place(second.entryId, first.entryId)).toBeNull();
        expect(session.place(first.entryId, second.entryId)).toBeNull();
        expect(session.place(later, second.entryId)).toBeNull();
        expect(session.place(second.entryId, later)).toBeNull();
        expect(session.place('zzz', second.entryId)).toBeNull();
    });

    it('這一頁還沒配完不能換頁', () => {
        const session = new MatchSession(rounds, 3, rng());
        session.nextPage();
        expect(session.pageIndex).toBe(0);
    });
});

describe('MatchSession.refit()：畫面大小改變後重新分頁', () => {
    const ids = 'abcdefghijklm'.split('');
    const rounds = ids.map(pair);
    const slotIds = (session: MatchSession) =>
        session.pages.map((page) => page.slots.map((slot) => slot.entryId));
    const sizes = (session: MatchSession) =>
        session.pages.map((page) => page.slots.length);

    it('還沒配的每一題恰好出現一次，配好的留在這一頁、仍然算配好，分數不變', () => {
        const session = new MatchSession(rounds.slice(0, 12), 6, rng());
        expect(sizes(session)).toEqual([6, 6]);
        session.place('a', 'a');
        session.place('b', 'b');
        session.place('d', 'c'); // 放錯一次
        session.place('c', 'c');
        expect(session.score).toBe(2);

        expect(session.refit(4, rng())).toBe(true);
        expect(session.pageIndex).toBe(0);
        // 12 題、每頁 4 組 → 4、4、4；配好的 3 題留在第一頁，補 1 題
        expect(slotIds(session)).toEqual([
            ['a', 'b', 'c', 'd'],
            ['e', 'f', 'g', 'h'],
            ['i', 'j', 'k', 'l'],
        ]);
        for (const page of session.pages) {
            expect(page.cards.map((c) => c.entryId).sort()).toEqual(
                page.slots.map((s) => s.entryId).sort(),
            );
        }
        for (const id of ['a', 'b', 'c']) {
            expect(session.isMatched(id)).toBe(true);
            expect(session.place(id, id)).toBeNull();
        }
        expect(session.score).toBe(2);
        expect(session.pageComplete).toBe(false);

        // 接著在新的一頁放卡片：presented 是新的一頁的卡片，配完換頁照舊
        expect(session.place('d', 'd')).toMatchObject({
            correct: true,
            firstTry: true,
            presented: expect.arrayContaining(['a', 'b', 'c', 'd']),
            pageComplete: true,
        });
        expect(session.score).toBe(3);
        session.nextPage();
        expect(session.pageIndex).toBe(1);
        expect(session.page?.slots.map((s) => s.entryId)).toEqual([
            'e',
            'f',
            'g',
            'h',
        ]);
    });

    it.each([
        // [題數, 這一頁配好幾題, 原本每頁, 新的每頁]
        [12, 0, 6, 4],
        [12, 3, 6, 4],
        [13, 2, 6, 4],
        [7, 1, 3, 6],
        [12, 1, 4, 6],
        [8, 2, 8, 3],
    ])(
        '%i 題、這一頁配好 %i 題、每頁 %i 組改成 %i 組：各頁組數與 pageSizes() 一樣平均',
        (count, matched, perPage, newPerPage) => {
            const session = new MatchSession(
                rounds.slice(0, count),
                perPage,
                rng(),
            );
            const page = session.page;
            for (const slot of page?.slots.slice(0, matched) ?? []) {
                session.place(slot.entryId, slot.entryId);
            }

            session.refit(newPerPage, rng());

            expect(sizes(session)).toEqual(pageSizes(count, newPerPage));
            expect(session.pageIndex).toBe(0);
            expect(slotIds(session).flat()).toEqual(ids.slice(0, count));
            expect(session.score).toBe(matched);
        },
    );

    it('配好的已經佔滿新的一頁：這一頁算配完、換到下一頁，剩下的另外平均分頁', () => {
        // 直向一頁 6 組、配好 4 組才轉成橫放，一頁只放得下 3 組
        const session = new MatchSession(rounds.slice(0, 6), 6, rng());
        for (const id of ['a', 'b', 'c', 'd']) {
            session.place(id, id);
        }

        expect(session.refit(3, rng())).toBe(true);
        expect(slotIds(session)).toEqual([
            ['a', 'b', 'c', 'd'],
            ['e', 'f'],
        ]);
        expect(session.pageIndex).toBe(1);
        expect(session.pages[0].cards.map((c) => c.entryId).sort()).toEqual([
            'a',
            'b',
            'c',
            'd',
        ]);
        expect(session.pageComplete).toBe(false);
        expect(session.score).toBe(4);

        session.place('e', 'e');
        session.place('f', 'f');
        expect(session.score).toBe(6);
        session.nextPage();
        expect(session.finished).toBe(true);
    });

    it('已經配完的頁不動；分頁沒有改變時回傳 false，卡片的順序也不變', () => {
        const session = new MatchSession(rounds.slice(0, 8), 4, rng());
        for (const id of ['a', 'b', 'c', 'd']) {
            session.place(id, id);
        }
        session.nextPage();
        const [done, current] = session.pages;

        // 剩下 4 題，每頁 6 組還是同一頁
        expect(session.refit(6, rng())).toBe(false);
        expect(session.pages[0]).toBe(done);
        expect(session.pages[1]).toBe(current);
        expect(session.pageIndex).toBe(1);

        expect(session.refit(3, rng())).toBe(true);
        expect(session.pages[0]).toBe(done);
        expect(slotIds(session)).toEqual([
            ['a', 'b', 'c', 'd'],
            ['e', 'f'],
            ['g', 'h'],
        ]);
        expect(session.pageIndex).toBe(1);
    });

    it('剛建立、全部配完或這一頁是最後一頁且配完時不重新分頁', () => {
        const fresh = new MatchSession(rounds.slice(0, 7), 6, rng());
        expect(fresh.refit(6, rng())).toBe(false);

        const session = new MatchSession(rounds.slice(0, 3), 6, rng());
        for (const id of ['a', 'b', 'c']) {
            session.place(id, id);
        }
        expect(session.refit(3, rng())).toBe(false);
        session.nextPage();
        expect(session.finished).toBe(true);
        expect(session.refit(3, rng())).toBe(false);
    });

    it('layout、sameLayout() 與 restore()：試過別的組數後可以回到原本的分頁', () => {
        const session = new MatchSession(rounds.slice(0, 12), 4, rng());
        session.place('a', 'a');
        const before = session.layout;
        const cards = session.page?.cards;

        // 12 題：每頁 4 組是 4、4、4，每頁 6 組是 6、6
        expect(session.refit(6, rng())).toBe(true);
        expect(session.sameLayout(before)).toBe(false);
        // 再改回 4 組：題目的分頁和原本一樣，但卡片重新打亂過
        expect(session.refit(4, rng())).toBe(true);
        expect(session.sameLayout(before)).toBe(true);

        session.restore(before);
        expect(session.pages).toEqual(before.pages);
        expect(session.pageIndex).toBe(before.pageIndex);
        expect(session.page?.cards).toBe(cards);
        expect(session.isMatched('a')).toBe(true);
        expect(session.score).toBe(1);
    });
});

describe('與 @kancil-quiz/deck 的判定一致（docs/SPEC.md 7.6）', () => {
    const compatible = Object.entries(fixtures).filter(
        ([, set]) => check(set, meta.requires).ok,
    );

    it('至少有詞彙組與問答組的 fixture 可以玩配對', () => {
        const kinds = new Set(compatible.map(([, set]) => set.kind));
        expect(kinds).toEqual(new Set(['vocab', 'quiz']));
    });

    // 每一題先放錯一次（放下一題的卡片），再放對。refit 為 true 時每一頁配完後重新分頁一次
    // （模擬轉向），之後的作答仍然要與 judge() 一致
    function playThrough(set: KancilSet, refit: boolean): number {
        const rounds = pairRounds(
            buildRounds(set, meta.requires, { rng: createRng(3) }),
        );
        const rng = createRng(5);
        const session = new MatchSession(rounds, 3, rng);
        const refitted = new Set<number>();
        let perPage = 3;
        let answered = 0;

        while (!session.finished) {
            const page = session.page;
            if (!page) {
                break;
            }
            for (const [i, slot] of page.slots.entries()) {
                const tries = [
                    page.slots[(i + 1) % page.slots.length].entryId,
                    slot.entryId,
                ];
                for (const cardId of tries) {
                    const result = session.place(cardId, slot.entryId);
                    if (!result) {
                        continue;
                    }
                    answered++;
                    expect(
                        judge(set, 'pair', {
                            entryId: result.entryId,
                            presented: result.presented,
                            selected: [result.selected],
                        }),
                    ).toBe(result.correct);
                }
            }
            if (refit && !refitted.has(session.pageIndex)) {
                refitted.add(session.pageIndex);
                perPage = perPage === 3 ? 5 : 3;
                session.refit(perPage, rng);
            }
            session.nextPage();
        }

        expect(session.finished).toBe(true);
        return answered;
    }

    it.each(compatible)(
        '%s：每次放卡片的判定都與 judge() 相同',
        (_path, set) => {
            expect(playThrough(set, false)).toBeGreaterThan(set.entries.length);
        },
    );

    it.each(compatible)(
        '%s：中途重新分頁後，判定仍與 judge() 相同',
        (_path, set) => {
            expect(playThrough(set, true)).toBeGreaterThan(set.entries.length);
        },
    );
});
