import { lapFactor } from '@kancil-quiz/arcade';
import type { Speed } from './meta';

// 星星、輪次、一批一批的目標與倒數是和打地鼠共用的規則，在 @kancil-quiz/arcade（kancil-games/arcade）。
// 這裡是射氣球自己的：氣球飄多快、拉弓、箭有沒有碰到氣球、跑道。都不碰 DOM，方便測試。
// 座標是遊戲區內的像素，x 往右、y 往下（與畫面相同）。弓箭手在左邊上下移動，箭一律水平往右飛。

/** 第一輪各速度的氣球從下面飄到上面要多久（毫秒） */
const RISE_MS: Readonly<Record<Speed, number>> = {
    slow: 8000,
    normal: 6000,
    fast: 4500,
};

/** 氣球飄過整個遊戲區要多久：每多輪一次少 10%，最少是第一輪的 60% */
export function riseMs(speed: Speed, lap: number): number {
    return Math.round(RISE_MS[speed] * lapFactor(lap));
}

/** 往左拉多遠（像素）才算拉弓；拉得太短，放開時不射，只是移動弓箭手 */
export const MIN_PULL = 16;

/** 放開時射不射：往左拉夠遠才射（往右拉不算） */
export function willShoot(dx: number): boolean {
    return -dx >= MIN_PULL;
}

/** 弓弦拉了多少（0 到 1），只影響弓弦的樣子，不影響箭的速度 */
export function pullOf(dx: number, full: number): number {
    return Math.min(1, Math.max(0, -dx) / full);
}

/** 弓箭手的高度限制在 min 到 max 之間 */
export function clampY(y: number, min: number, max: number): number {
    return Math.min(Math.max(y, min), Math.max(min, max));
}

/** 箭每秒飛多遠：遊戲區寬度的 1.3 倍，大螢幕與手機飛過畫面的時間差不多 */
export function arrowSpeed(width: number): number {
    return width * 1.3;
}

export interface Ellipse {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
}

export interface Point {
    x: number;
    y: number;
}

// 箭頭這一格從 from 移到 to，路上有沒有碰到氣球：每隔 step 像素檢查一次，箭飛得快也不會穿過去。
// 回傳第一個碰到的氣球的索引，沒碰到時是 −1
export function firstHit(
    from: Point,
    to: Point,
    ellipses: readonly Ellipse[],
    step = 6,
): number {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / step));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;
        const index = ellipses.findIndex(
            (e) =>
                e.rx > 0 &&
                e.ry > 0 &&
                ((x - e.cx) / e.rx) ** 2 + ((y - e.cy) / e.ry) ** 2 <= 1,
        );
        if (index >= 0) {
            return index;
        }
    }
    return -1;
}

/** 一批氣球的跑道數：每條跑道要放得下最寬的氣球，2 到 6 條 */
export function laneCount(width: number, balloonWidth: number): number {
    const lanes = Math.floor(width / (Math.max(1, balloonWidth) * 1.15));
    return Math.min(6, Math.max(2, lanes));
}

/** 第幾條跑道的中線：跑道平均分布在 start 到 end 之間（弓箭手右邊的天空） */
export function laneX(
    lane: number,
    lanes: number,
    start: number,
    end: number,
): number {
    return start + ((lane + 0.5) * (end - start)) / lanes;
}
