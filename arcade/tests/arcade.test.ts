import { createRng } from '@kancil-quiz/deck';
import { describe, expect, it } from 'vite-plus/test';
import {
    Countdown,
    MAX_TARGETS,
    START_STARS,
    StarSession,
    lapFactor,
    pickWave,
    waveHasAnswer,
} from '../src';
import type { McqRound } from '../src';

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

describe('StarSession', () => {
    it('從 3 顆星開始，打對 +1 換下一題，打錯 −1 留在同一題', () => {
        const session = new StarSession(rounds(3), createRng(1));
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
        const session = new StarSession(rounds(2), createRng(1));
        for (let i = 0; i < 5; i++) {
            session.hit(wrongOf(session.current!));
        }
        expect(session.stars).toBe(0);
        expect(session.hit(wrongOf(session.current!))?.delta).toBe(0);
        expect(session.hit('e1')?.delta).toBe(1);
        expect(session.stars).toBe(1);
    });

    it('題目打完重新洗牌再輪一次，之後幾輪的作答不回報', () => {
        const session = new StarSession(rounds(5), createRng(4));
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
            const session = new StarSession(rounds(3), createRng(seed));
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
        const session = new StarSession(rounds(1), createRng(1));
        session.hit('e1');
        session.hit('e1');
        expect(session.lap).toBe(2);
        expect(session.current?.entryId).toBe('e1');
    });

    it('時間到之後不能再打', () => {
        const session = new StarSession(rounds(2), createRng(1));
        session.end();
        expect(session.current).toBeUndefined();
        expect(session.hit('e1')).toBeNull();
        expect(session.stars).toBe(START_STARS);
    });

    it('不認得的選項不算作答', () => {
        const session = new StarSession(rounds(2), createRng(1));
        expect(session.hit('zzz')).toBeNull();
        expect(session.stars).toBe(START_STARS);
    });
});

describe('pickWave()', () => {
    it('有正解的一批：最多 3 個、位置與選項都不重複，其中一個是正解', () => {
        for (let seed = 0; seed < 50; seed++) {
            const wave = pickWave(mcq('e1', 6), 9, {
                withAnswer: true,
                rng: createRng(seed),
            });
            expect(wave).toHaveLength(MAX_TARGETS);
            expect(new Set(wave.map((m) => m.slot)).size).toBe(MAX_TARGETS);
            expect(new Set(wave.map((m) => m.optionId)).size).toBe(MAX_TARGETS);
            expect(wave.filter((m) => m.optionId === 'e1')).toHaveLength(1);
            expect(wave.every((m) => m.slot >= 0 && m.slot < 9)).toBe(true);
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

    it('選項少時目標也少', () => {
        const wave = pickWave(mcq('e1', 2), 9, {
            withAnswer: true,
            rng: createRng(2),
        });
        expect(wave.map((m) => m.optionId).sort()).toEqual(['e1', 'e1-x1']);
    });

    it('盡量不用上一批的位置', () => {
        for (let seed = 0; seed < 20; seed++) {
            const wave = pickWave(mcq('e1', 4), 9, {
                withAnswer: true,
                avoidSlots: [0, 1, 2, 3, 4, 5],
                rng: createRng(seed),
            });
            expect(wave.map((m) => m.slot).sort((a, b) => a - b)).toEqual([
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

describe('lapFactor()', () => {
    it('每多輪一次少 10%，最少是第一輪的 60%', () => {
        expect(lapFactor(0)).toBe(1);
        expect(lapFactor(1)).toBeCloseTo(0.9);
        expect(lapFactor(4)).toBeCloseTo(0.6);
        expect(lapFactor(9)).toBe(0.6);
    });
});
