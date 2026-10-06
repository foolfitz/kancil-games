import { buildRounds, check, createRng, judge } from '@kancil-quiz/deck';
import type { Round } from '@kancil-quiz/games-sdk';
import type { KancilSet } from '@kancil-quiz/schema';
import { describe, expect, it } from 'vite-plus/test';
import { meta, normalizeOptions } from '../src/meta';
import {
    Countdown,
    MAX_MOLES,
    START_STARS,
    WhackSession,
    mcqRounds,
    pickWave,
    upMs,
    waveHasAnswer,
} from '../src/session';
import type { McqRound } from '../src/session';

// 共用的 fixture 在平台的 packages/schema；以 / 開頭是從平台的根目錄算起，這個 repo 掛在哪一層都找得到
const fixtures = import.meta.glob<KancilSet>(
    '/packages/schema/fixtures/sets/*/set.json',
    { eager: true, import: 'default' },
);

function mcq(entryId: string, optionCount = 4): McqRound {
    return {
        shape: 'mcq',
        entryId,
        prompt: { text: `題目 ${entryId}` },
        options: Array.from({ length: optionCount }, (_, i) => ({
            id: i === 0 ? entryId : `${entryId}-x${i}`,
            face: { text: `選項 ${entryId} ${i}` },
            correct: i === 0,
        })),
    };
}

const rounds = (count: number) =>
    Array.from({ length: count }, (_, i) => mcq(`e${i + 1}`));

const wrongOf = (round: McqRound) =>
    round.options.find((o) => !o.correct)?.id ?? '';

describe('WhackSession', () => {
    it('從 3 顆星開始，打對 +1 換下一題，打錯 −1 留在同一題', () => {
        const session = new WhackSession(rounds(3), createRng(1));
        expect(session.stars).toBe(START_STARS);

        const first = session.current!;
        expect(session.hit(wrongOf(first))).toMatchObject({
            entryId: 'e1',
            correct: false,
            report: true,
            delta: -1,
        });
        expect(session.stars).toBe(2);
        expect(session.current).toBe(first);

        expect(session.hit('e1')).toMatchObject({
            correct: true,
            report: true,
            delta: 1,
        });
        expect(session.stars).toBe(3);
        expect(session.current?.entryId).toBe('e2');
    });

    it('星星最少 0 顆，扣到 0 之後仍可以繼續玩', () => {
        const session = new WhackSession(rounds(2), createRng(1));
        for (let i = 0; i < 5; i++) {
            session.hit(wrongOf(session.current!));
        }
        expect(session.stars).toBe(0);
        expect(session.hit(wrongOf(session.current!))?.delta).toBe(0);
        expect(session.hit('e1')?.delta).toBe(1);
        expect(session.stars).toBe(1);
    });

    it('題目打完重新洗牌再輪一次，之後幾輪的作答不回報', () => {
        const session = new WhackSession(rounds(5), createRng(4));
        const firstLap = [];
        while (session.lap === 0) {
            const round = session.current!;
            firstLap.push(round.entryId);
            expect(session.hit(round.entryId)?.report).toBe(true);
        }
        expect(firstLap).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);

        const secondLap = [];
        while (session.lap === 1) {
            const round = session.current!;
            secondLap.push(round.entryId);
            expect(session.hit(wrongOf(round))?.report).toBe(false);
            expect(session.hit(round.entryId)?.report).toBe(false);
        }
        expect([...secondLap].sort()).toEqual(firstLap);
        // 3 顆起始，第一輪 +5，第二輪每題 −1 +1
        expect(session.stars).toBe(8);
    });

    it('上一輪的最後一題不會馬上又出現', () => {
        for (let seed = 0; seed < 50; seed++) {
            const session = new WhackSession(rounds(3), createRng(seed));
            let last = '';
            for (let i = 0; i < 12; i++) {
                const round = session.current!;
                if (i > 0 && i % 3 === 0) {
                    expect(round.entryId).not.toBe(last);
                }
                last = round.entryId;
                session.hit(round.entryId);
            }
        }
    });

    it('只有一題時一直輪同一題', () => {
        const session = new WhackSession(rounds(1), createRng(1));
        session.hit('e1');
        session.hit('e1');
        expect(session.lap).toBe(2);
        expect(session.current?.entryId).toBe('e1');
    });

    it('時間到之後不能再打', () => {
        const session = new WhackSession(rounds(2), createRng(1));
        session.end();
        expect(session.current).toBeUndefined();
        expect(session.hit('e1')).toBeNull();
        expect(session.stars).toBe(START_STARS);
    });

    it('不認得的選項不算作答', () => {
        const session = new WhackSession(rounds(2), createRng(1));
        expect(session.hit('zzz')).toBeNull();
        expect(session.stars).toBe(START_STARS);
    });
});

describe('pickWave()', () => {
    it('有正解的一批：最多 3 隻、洞與選項都不重複，其中一隻是正解', () => {
        for (let seed = 0; seed < 50; seed++) {
            const wave = pickWave(mcq('e1', 6), 9, {
                withAnswer: true,
                rng: createRng(seed),
            });
            expect(wave).toHaveLength(MAX_MOLES);
            expect(new Set(wave.map((m) => m.hole)).size).toBe(MAX_MOLES);
            expect(new Set(wave.map((m) => m.optionId)).size).toBe(MAX_MOLES);
            expect(wave.filter((m) => m.optionId === 'e1')).toHaveLength(1);
            expect(wave.every((m) => m.hole >= 0 && m.hole < 9)).toBe(true);
        }
    });

    it('沒有正解的一批只有干擾選項', () => {
        const wave = pickWave(mcq('e1', 4), 9, {
            withAnswer: false,
            rng: createRng(2),
        });
        expect(wave).toHaveLength(3);
        expect(wave.some((m) => m.optionId === 'e1')).toBe(false);
    });

    it('選項少時地鼠也少', () => {
        const wave = pickWave(mcq('e1', 2), 9, {
            withAnswer: true,
            rng: createRng(2),
        });
        expect(wave.map((m) => m.optionId).sort()).toEqual(['e1', 'e1-x1']);
    });

    it('盡量不用上一批的洞', () => {
        for (let seed = 0; seed < 20; seed++) {
            const wave = pickWave(mcq('e1', 4), 9, {
                withAnswer: true,
                avoidHoles: [0, 1, 2, 3, 4, 5],
                rng: createRng(seed),
            });
            expect(wave.map((m) => m.hole).sort((a, b) => a - b)).toEqual([
                6, 7, 8,
            ]);
        }
    });
});

describe('waveHasAnswer()', () => {
    it('每一題的第一批一定有正解，也不會連續兩批沒有', () => {
        const never = () => 0.99;
        expect(waveHasAnswer(true, true, never)).toBe(true);
        expect(waveHasAnswer(false, false, never)).toBe(true);
        expect(waveHasAnswer(false, true, never)).toBe(false);
        expect(waveHasAnswer(false, true, () => 0.1)).toBe(true);
    });
});

describe('upMs()', () => {
    it('每多輪一次少 10%，最少是第一輪的 60%', () => {
        expect(upMs('slow', 0)).toBe(3000);
        expect(upMs('slow', 1)).toBe(2700);
        expect(upMs('slow', 4)).toBe(1800);
        expect(upMs('slow', 9)).toBe(1800);
        expect(upMs('fast', 0)).toBeLessThan(upMs('normal', 0));
    });
});

describe('Countdown', () => {
    it('暫停時不算時間', () => {
        const countdown = new Countdown(60_000);
        countdown.start(1000);
        expect(countdown.remaining(11_000)).toBe(50_000);
        countdown.pause(11_000);
        expect(countdown.remaining(40_000)).toBe(50_000);
        countdown.start(40_000);
        expect(countdown.remaining(45_000)).toBe(45_000);
        expect(countdown.remaining(200_000)).toBe(0);
    });
});

describe('normalizeOptions()', () => {
    it('不合法的設定退回預設，秒數限制在範圍內', () => {
        expect(normalizeOptions(undefined)).toEqual(meta.defaultOptions);
        expect(normalizeOptions({ seconds: 5, speed: 'fast' })).toEqual({
            seconds: 30,
            speed: 'fast',
        });
        expect(
            normalizeOptions({
                seconds: 999,
                speed: 'turbo' as never,
            }),
        ).toEqual({ seconds: 180, speed: 'slow' });
    });
});

// 7.6：遊戲回報的 correct 必須與 @kancil-quiz/deck 的 judge() 一致
describe('與 judge() 一致', () => {
    const compatible = Object.entries(fixtures).filter(
        ([, set]) => check(set, meta.requires).ok,
    );

    it('有相容的 fixture', () => {
        expect(compatible.length).toBeGreaterThan(0);
    });

    it.each(compatible)('%s', (_, set) => {
        const built: Round[] = buildRounds(set, meta.requires, {
            rng: createRng(3),
        });
        const session = new WhackSession(mcqRounds(built), createRng(5));
        let reported = 0;

        // 第一輪每題先打一個錯的再打對，之後再輪一次：只有第一輪回報，回報的都要與 judge() 一致
        while (session.lap < 2) {
            const round = session.current!;
            const firstLap = session.lap === 0;
            const wrong = round.options.find((o) => !o.correct)!;
            const answer = round.options.find((o) => o.correct)!;
            for (const option of [wrong, answer]) {
                const result = session.hit(option.id)!;
                expect(result.report).toBe(firstLap);
                if (result.report) {
                    reported++;
                    expect(result.correct).toBe(
                        judge(set, 'mcq', {
                            entryId: result.entryId,
                            presented: round.options.map((o) => o.id),
                            selected: [result.selected],
                        }),
                    );
                }
            }
        }
        expect(reported).toBe(built.length * 2);
    });
});
