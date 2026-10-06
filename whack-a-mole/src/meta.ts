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

export interface WhackAMoleOptions {
    /** 整場的時間，時間到就結束 */
    seconds: number;
    /** 地鼠冒出來後停留多久 */
    speed: Speed;
}

const defaultOptions: WhackAMoleOptions = { seconds: 60, speed: 'slow' };

// 遊戲的設定資訊，不含執行程式；老師端與伺服器端的遊戲清單（manifest.json）都由此產生。
export const meta = {
    id: 'whack-a-mole',
    version: '0.1.0',
    title: { 'zh-TW': '打地鼠' },
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
        title: '打地鼠的設定',
        type: 'object',
        additionalProperties: false,
        required: ['seconds', 'speed'],
        properties: {
            seconds: {
                title: '遊戲時間（秒）',
                description:
                    '時間到就結束。題目打完會重新洗牌再輪一次，打得又快又準，星星就越多；第一輪沒輪到的題目算答錯。',
                type: 'integer',
                minimum: OPTION_LIMITS.seconds.min,
                maximum: OPTION_LIMITS.seconds.max,
                default: defaultOptions.seconds,
            },
            speed: {
                title: '地鼠的速度',
                description:
                    '地鼠冒出來後停留多久。每多輪一次，地鼠會再快一點。',
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
} satisfies Omit<GameModule<WhackAMoleOptions>, 'mount'>;

// 舊的或不合法的設定值一律退回預設，不讓遊戲壞掉
export function normalizeOptions(
    raw: Partial<WhackAMoleOptions> | undefined,
): WhackAMoleOptions {
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
