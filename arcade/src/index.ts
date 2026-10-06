import type { Round } from '@kancil-quiz/games-sdk';

// 打地鼠、射氣球共用的規則（docs/SPEC.md 7.5）。都不碰 DOM，方便測試；畫面由各遊戲自己做。
// 上方出一題，目標（地鼠、氣球）一批一批出現，各帶著一個選項，打中帶著正解的那個。
// 開始時 3 顆星，打對 +1、換下一題；打錯 −1、留在同一題。題目打完重新洗牌再輪一次，直到時間到。

export type McqRound = Extract<Round, { shape: 'mcq' }>;

/** 開始時的星星數；打對 +1、打錯 −1，最少 0 顆 */
export const START_STARS = 3;

/** 一批最多出現幾個目標 */
export const MAX_TARGETS = 3;

/** 每多輪一次變快多少：時間乘上這個倍數，每輪少 10%，最少是第一輪的 60% */
export function lapFactor(lap: number): number {
    return Math.max(0.6, 1 - 0.1 * lap);
}

export interface HitResult {
    entryId: string;
    selected: string;
    correct: boolean;
    /** 要不要回報給宿主。只回報第一輪：成績只看每題第一次打的（7.4），之後幾輪只加減星星 */
    report: boolean;
    /** 星星的變化：+1 或 −1；已經 0 顆時打錯是 0 */
    delta: number;
}

// 打對換下一題，打錯留在同一題；題目打完重新洗牌再輪一次，直到時間到（end()）。
export class StarSession {
    stars = START_STARS;
    /** 第幾輪，從 0 算起 */
    lap = 0;
    ended = false;
    private order: McqRound[];
    private position = 0;

    constructor(
        readonly rounds: McqRound[],
        private readonly rng: () => number,
    ) {
        this.order = [...rounds];
    }

    get current(): McqRound | undefined {
        return this.ended ? undefined : this.order[this.position];
    }

    hit(optionId: string): HitResult | null {
        const round = this.current;
        const option = round?.options.find((o) => o.id === optionId);
        if (!round || !option) {
            return null;
        }

        const before = this.stars;
        this.stars = option.correct
            ? this.stars + 1
            : Math.max(0, this.stars - 1);
        const result: HitResult = {
            entryId: round.entryId,
            selected: option.id,
            correct: option.correct,
            report: this.lap === 0,
            delta: this.stars - before,
        };
        if (option.correct) {
            this.advance();
        }
        return result;
    }

    end(): void {
        this.ended = true;
    }

    private advance(): void {
        this.position++;
        if (this.position < this.order.length) {
            return;
        }
        const last = this.order[this.order.length - 1];
        this.lap++;
        this.position = 0;
        this.order = shuffle(this.rounds, this.rng);
        // 上一輪的最後一題不要馬上又出現
        if (this.order.length > 1 && this.order[0] === last) {
            const other = 1 + Math.floor(this.rng() * (this.order.length - 1));
            [this.order[0], this.order[other]] = [
                this.order[other],
                this.order[0],
            ];
        }
    }
}

/** 一批中的一個目標：在第幾個位置（地鼠的洞、氣球的跑道），帶著哪個選項 */
export interface Target {
    slot: number;
    optionId: string;
}

// 下一批目標：最多 size 個，各在不同的位置、帶著不同的選項。withAnswer 時其中一個帶著正解。
// 盡量不用上一批的位置（avoidSlots），目標才會到處出現。
export function pickWave(
    round: McqRound,
    slotCount: number,
    {
        withAnswer,
        avoidSlots = [],
        size = MAX_TARGETS,
        rng,
    }: {
        withAnswer: boolean;
        avoidSlots?: number[];
        size?: number;
        rng: () => number;
    },
): Target[] {
    const answer = round.options.filter((o) => o.correct);
    const others = shuffle(
        round.options.filter((o) => !o.correct),
        rng,
    );
    const labels = withAnswer
        ? [...answer.slice(0, 1), ...others]
        : others.length > 0
          ? others
          : answer;
    const count = Math.min(size, labels.length, slotCount);

    const slots = Array.from({ length: slotCount }, (_, i) => i);
    const fresh = shuffle(
        slots.filter((s) => !avoidSlots.includes(s)),
        rng,
    );
    const used = shuffle(
        slots.filter((s) => avoidSlots.includes(s)),
        rng,
    );
    const chosen = [...fresh, ...used].slice(0, count);

    // 正解不一定是第一個出現的
    return shuffle(
        labels
            .slice(0, count)
            .map((option, i) => ({ slot: chosen[i], optionId: option.id })),
        rng,
    );
}

// 這一批要不要有正解：每一題的第一批一定有；之後七成有，但不會連續兩批都沒有
export function waveHasAnswer(
    firstOfRound: boolean,
    previousHadAnswer: boolean,
    rng: () => number,
): boolean {
    return firstOfRound || !previousHadAnswer || rng() < 0.7;
}

// 倒數計時：暫停時不算時間。時間由呼叫的人傳入（performance.now()），測試才能控制
export class Countdown {
    private spent = 0;
    private since: number | null = null;

    constructor(readonly totalMs: number) {}

    get running(): boolean {
        return this.since !== null;
    }

    start(now: number): void {
        this.since ??= now;
    }

    pause(now: number): void {
        if (this.since !== null) {
            this.spent += now - this.since;
            this.since = null;
        }
    }

    elapsed(now: number): number {
        return this.spent + (this.since === null ? 0 : now - this.since);
    }

    remaining(now: number): number {
        return Math.max(0, this.totalMs - this.elapsed(now));
    }
}

export function mcqRounds(rounds: Round[]): McqRound[] {
    return rounds.filter((round): round is McqRound => round.shape === 'mcq');
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
