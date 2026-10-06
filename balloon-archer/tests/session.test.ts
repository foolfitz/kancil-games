import { StarSession, mcqRounds } from '@kancil-quiz/arcade';
import { buildRounds, check, createRng, judge } from '@kancil-quiz/deck';
import type { Round } from '@kancil-quiz/games-sdk';
import type { KancilSet } from '@kancil-quiz/schema';
import { describe, expect, it } from 'vite-plus/test';
import { meta, normalizeOptions } from '../src/meta';
import {
    MIN_PULL,
    arrowSpeed,
    clampY,
    firstHit,
    laneCount,
    laneX,
    pullOf,
    riseMs,
    willShoot,
} from '../src/session';

// 星星、輪次、一批一批的目標與倒數在 @kancil-quiz/arcade，測試也在那裡（kancil-games/arcade/tests）。

// 共用的 fixture 在平台的 packages/schema；以 / 開頭是從平台的根目錄算起，這個 repo 掛在哪一層都找得到
const fixtures = import.meta.glob<KancilSet>(
    '/packages/schema/fixtures/sets/*/set.json',
    { eager: true, import: 'default' },
);

describe('willShoot() 與 pullOf()', () => {
    it('往左拉夠遠才射，往右拉不算', () => {
        expect(willShoot(-MIN_PULL)).toBe(true);
        expect(willShoot(-(MIN_PULL - 1))).toBe(false);
        expect(willShoot(80)).toBe(false);
    });

    it('弓弦拉了多少：往左拉的距離，最多拉滿', () => {
        expect(pullOf(-45, 90)).toBe(0.5);
        expect(pullOf(-200, 90)).toBe(1);
        expect(pullOf(30, 90)).toBe(0);
    });
});

describe('clampY()', () => {
    it('弓箭手的高度限制在範圍內', () => {
        expect(clampY(50, 20, 300)).toBe(50);
        expect(clampY(5, 20, 300)).toBe(20);
        expect(clampY(400, 20, 300)).toBe(300);
        // 遊戲區太矮、範圍顛倒時停在上限
        expect(clampY(100, 50, 40)).toBe(50);
    });
});

describe('firstHit()', () => {
    const balloons = [
        { cx: 100, cy: 100, rx: 40, ry: 50 },
        { cx: 100, cy: 300, rx: 40, ry: 50 },
    ];

    it('箭頭經過氣球就算射中，回傳第一個碰到的', () => {
        expect(firstHit({ x: 100, y: 500 }, { x: 100, y: 0 }, balloons)).toBe(
            1,
        );
        expect(firstHit({ x: 100, y: 200 }, { x: 100, y: 0 }, balloons)).toBe(
            0,
        );
    });

    it('飛得再快也不會穿過氣球', () => {
        // 一格就從氣球下面飛到上面
        expect(firstHit({ x: 100, y: 180 }, { x: 100, y: 10 }, balloons)).toBe(
            0,
        );
    });

    it('從旁邊經過不算射中', () => {
        expect(firstHit({ x: 145, y: 500 }, { x: 145, y: 0 }, balloons)).toBe(
            -1,
        );
    });

    it('已經破掉（半徑為 0）的氣球射不到', () => {
        const popped = [{ cx: 100, cy: 100, rx: 0, ry: 0 }];
        expect(firstHit({ x: 100, y: 200 }, { x: 100, y: 0 }, popped)).toBe(-1);
    });
});

describe('laneCount() 與 laneX()', () => {
    it('每條跑道放得下最寬的氣球，2 到 6 條', () => {
        expect(laneCount(1000, 150)).toBe(5);
        expect(laneCount(374, 150)).toBe(2);
        expect(laneCount(200, 150)).toBe(2);
        expect(laneCount(3000, 100)).toBe(6);
    });

    it('跑道的中線平均分布在弓箭手右邊的天空', () => {
        expect(laneX(0, 4, 200, 1000)).toBe(300);
        expect(laneX(3, 4, 200, 1000)).toBe(900);
    });
});

describe('riseMs() 與 arrowSpeed()', () => {
    it('每多輪一次少 10%，最少是第一輪的 60%', () => {
        expect(riseMs('slow', 0)).toBe(8000);
        expect(riseMs('slow', 1)).toBe(7200);
        expect(riseMs('slow', 9)).toBe(4800);
        expect(riseMs('fast', 0)).toBeLessThan(riseMs('normal', 0));
    });

    it('箭的速度跟著遊戲區的寬度', () => {
        expect(arrowSpeed(1000)).toBe(1300);
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
            normalizeOptions({ seconds: 999, speed: 'turbo' as never }),
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

        // 第一輪每題先射中一個錯的再射中正解，之後再輪一次：只有第一輪回報，回報的都要與 judge() 一致
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
