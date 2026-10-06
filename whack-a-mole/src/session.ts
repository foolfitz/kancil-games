import { lapFactor } from '@kancil-quiz/arcade';
import type { Speed } from './meta';

// 星星、輪次、一批一批的目標與倒數是和射氣球共用的規則，在 @kancil-quiz/arcade（kancil-games/arcade）。
// 這裡只有打地鼠自己的時間。

/** 第一輪各速度的地鼠停留多久（毫秒） */
const UP_MS: Readonly<Record<Speed, number>> = {
    slow: 3000,
    normal: 2200,
    fast: 1500,
};

/** 地鼠停留多久：每多輪一次少 10%，最少是第一輪的 60% */
export function upMs(speed: Speed, lap: number): number {
    return Math.round(UP_MS[speed] * lapFactor(lap));
}
