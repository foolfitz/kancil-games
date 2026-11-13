import type { GameModule } from '@kancil-quiz/games-sdk';

export const SPEEDS = ['slow', 'normal', 'fast'] as const;
export type Speed = (typeof SPEEDS)[number];

const SPEED_TITLES: Readonly<Record<Speed, string>> = {
    slow: '慢',
    normal: '中',
    fast: '快',
};

/** 設定值的範圍；optionsSchema 與 normalizeOptions() 都用這裡的值 */
export const OPTION_LIMITS = {
    seconds: { min: 30, max: 180 },
} as const;

export interface BalloonArcherOptions {
    /** 整場的時間，時間到就結束 */
    seconds: number;
    /** 氣球往上飄的速度 */
    speed: Speed;
}

const defaultOptions: BalloonArcherOptions = { seconds: 60, speed: 'slow' };

// 遊戲的設定資訊，不含執行程式；老師端與伺服器端的遊戲清單（manifest.json）都由此產生。
export const meta = {
    id: 'balloon-archer',
    version: '0.2.0',
    title: { 'zh-TW': '射氣球' },
    // 星星（起始 3 顆，射中正解 +1、射中錯的 −1）是遊戲得分，顯示在學生的結果頁與老師的成績頁
    scoreLabel: { 'zh-TW': '星星' },
    // 宿主的開始畫面列出的操作說明
    howTo: {
        'zh-TW': [
            '滑鼠、觸控：在想要的高度按住拉弓，放開就射箭；按住時可以上下移動',
            '鍵盤：↑ ↓ 移動，按住空白鍵拉弓，放開就射箭',
        ],
    },
    requires: {
        shape: 'mcq',
        minRounds: 1,
        optionCount: { min: 2, max: 6 },
        renders: {
            prompt: ['text', 'image', 'audio'],
            option: ['text', 'image'],
        },
        scored: true,
    },
    optionsSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: '射氣球的設定',
        type: 'object',
        additionalProperties: false,
        required: ['seconds', 'speed'],
        properties: {
            seconds: {
                title: '遊戲時間（秒）',
                description:
                    '時間到就結束。題目射完會重新洗牌再輪一次，射得又快又準，星星就越多；第一輪沒輪到的題目算答錯。',
                type: 'integer',
                minimum: OPTION_LIMITS.seconds.min,
                maximum: OPTION_LIMITS.seconds.max,
                default: defaultOptions.seconds,
            },
            speed: {
                title: '氣球的速度',
                description: '氣球往上飄得多快。每多輪一次，氣球會再快一點。',
                type: 'string',
                oneOf: SPEEDS.map((speed) => ({
                    const: speed,
                    title: SPEED_TITLES[speed],
                })),
                default: defaultOptions.speed,
            },
        },
    },
    defaultOptions,
} satisfies Omit<GameModule<BalloonArcherOptions>, 'mount'>;

// 舊的或不合法的設定值一律退回預設，不讓遊戲壞掉
export function normalizeOptions(
    raw: Partial<BalloonArcherOptions> | undefined,
): BalloonArcherOptions {
    const seconds = raw?.seconds;
    const speed = raw?.speed;
    return {
        seconds:
            typeof seconds === 'number' && Number.isFinite(seconds)
                ? Math.min(
                      OPTION_LIMITS.seconds.max,
                      Math.max(OPTION_LIMITS.seconds.min, Math.round(seconds)),
                  )
                : defaultOptions.seconds,
        speed: SPEEDS.includes(speed as Speed)
            ? (speed as Speed)
            : defaultOptions.speed,
    };
}
