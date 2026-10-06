import { buildRounds, check, createRng, judge } from '@kancil-quiz/deck';
import { StarSession, mcqRounds } from '@kancil-quiz/arcade';
import type { Round } from '@kancil-quiz/games-sdk';
import type { KancilSet } from '@kancil-quiz/schema';
import { describe, expect, it } from 'vite-plus/test';
import { meta, normalizeOptions } from '../src/meta';
import { upMs } from '../src/session';

// 星星、輪次、一批一批的目標與倒數在 @kancil-quiz/arcade，測試也在那裡（kancil-games/arcade/tests）。

// 共用的 fixture 在平台的 packages/schema；以 / 開頭是從平台的根目錄算起，這個 repo 掛在哪一層都找得到
const fixtures = import.meta.glob<KancilSet>(
    '/packages/schema/fixtures/sets/*/set.json',
    { eager: true, import: 'default' },
);

describe('upMs()', () => {
    it('每多輪一次少 10%，最少是第一輪的 60%', () => {
        expect(upMs('slow', 0)).toBe(3000);
        expect(upMs('slow', 1)).toBe(2700);
        expect(upMs('slow', 4)).toBe(1800);
        expect(upMs('slow', 9)).toBe(1800);
        expect(upMs('fast', 0)).toBeLessThan(upMs('normal', 0));
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
        const session = new StarSession(mcqRounds(built), createRng(5));
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
