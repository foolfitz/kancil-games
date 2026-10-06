import type {
    Face,
    GameContext,
    GameInstance,
    GameModule,
} from '@kancil-quiz/games-sdk';
import { meta, normalizeOptions } from './meta';
import type { WhackAMoleOptions } from './meta';
import {
    Countdown,
    WhackSession,
    mcqRounds,
    pickWave,
    upMs,
    waveHasAnswer,
} from './session';
import './style.css';

export type { WhackAMoleOptions } from './meta';

const HOLES = 9;
/** 同一批的地鼠依序冒出來的間隔 */
const STAGGER_MS = 280;
/** 一批都縮回去之後，到下一批冒出來 */
const WAVE_GAP_MS = 350;
/** 換題之後先看題目，再冒出第一批 */
const FIRST_WAVE_MS = 450;
/** 打對之後停一下再換題 */
const HIT_PAUSE_MS = 550;
/** 打錯的地鼠搖頭多久才縮回去 */
const MISS_MS = 500;
/** 「時間到」顯示多久才結束 */
const END_MS = 1800;
const TICK_MS = 200;
/** 「再一輪」的提示顯示多久 */
const TOAST_MS = 1600;
/** 剩幾秒時倒數變成紅色 */
const LOW_SECONDS = 10;

// 地鼠的樣子（不用圖檔）。顏色由 CSS 變數決定
const CRITTER = `<svg class="kq-whack__critter" viewBox="0 0 100 82" aria-hidden="true">
<circle cx="20" cy="20" r="10" class="kq-whack__fur"/>
<circle cx="80" cy="20" r="10" class="kq-whack__fur"/>
<circle cx="20" cy="20" r="5" class="kq-whack__skin"/>
<circle cx="80" cy="20" r="5" class="kq-whack__skin"/>
<path d="M10 82V46a40 38 0 0 1 80 0v36z" class="kq-whack__fur"/>
<ellipse cx="50" cy="56" rx="21" ry="15" class="kq-whack__skin"/>
<circle cx="35" cy="38" r="5.5" fill="#1f1a17"/>
<circle cx="65" cy="38" r="5.5" fill="#1f1a17"/>
<circle cx="36.8" cy="36.2" r="1.8" fill="#fff"/>
<circle cx="66.8" cy="36.2" r="1.8" fill="#fff"/>
<ellipse cx="50" cy="49" rx="6.5" ry="4.8" fill="#e88c9a"/>
<path d="M44.5 60h11v7.5a1.5 1.5 0 0 1-1.5 1.5h-8a1.5 1.5 0 0 1-1.5-1.5z" fill="#fff" stroke="#cfc6b8" stroke-width=".8"/>
<path d="M50 60v9" stroke="#cfc6b8" stroke-width=".8"/>
</svg>`;

type HoleState = 'down' | 'up' | 'hit' | 'miss';

interface Hole {
    button: HTMLButtonElement;
    sign: HTMLElement;
    state: HoleState;
    optionId: string | null;
}

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function renderFace(face: Face, className: string): HTMLElement {
    const box = el('span', className);
    if (face.image) {
        const img = el('img', 'kq-whack__image');
        img.src = face.image;
        img.alt = face.text ?? '';
        img.draggable = false;
        // 圖片載入失敗時只留文字，不讓畫面壞掉
        img.addEventListener('error', () => img.remove(), { once: true });
        box.append(img);
    }
    if (face.text) {
        const text = el('span', 'kq-whack__text', face.text);
        if (face.lang) {
            text.lang = face.lang;
        }
        box.append(text);
    }
    return box;
}

function faceLabel(face: Face): string {
    return face.text ?? '（圖片）';
}

function mount(
    host: HTMLElement,
    ctx: GameContext<WhackAMoleOptions>,
): GameInstance {
    const options = normalizeOptions(ctx.options);
    const session = new WhackSession(mcqRounds(ctx.rounds), ctx.rng);
    const countdown = new Countdown(options.seconds * 1000);
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let tickTimer: ReturnType<typeof setInterval> | undefined;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    let paused = false;
    let finished = false;
    let finalElapsed = 0;
    let roundStartedAt = performance.now();
    let shownLap = 0;

    // 地鼠一批一批冒出來；wave 每換一批（或換題、暫停）就加一，舊的計時器看到不同的 wave 就不動作
    let wave = 0;
    let pending = 0;
    let lastHoles: number[] = [];
    let firstOfRound = true;
    let previousHadAnswer = true;

    const root = el('div', 'kq-whack');
    root.lang = ctx.language;
    const layout = el('div', 'kq-whack__layout');
    const head = el('div', 'kq-whack__head');
    const status = el('div', 'kq-whack__status');
    const stars = el('span', 'kq-whack__stars');
    const lap = el('span', 'kq-whack__lap');
    const clock = el('span', 'kq-whack__timer');
    status.append(stars, lap, clock);
    const prompt = el('div', 'kq-whack__prompt');
    head.append(status, prompt);
    const field = el('div', 'kq-whack__field');
    const toast = el('div', 'kq-whack__toast');
    toast.setAttribute('aria-hidden', 'true');
    const live = el('div', 'kq-whack__live');
    live.setAttribute('role', 'status');
    const banner = el('div', 'kq-whack__banner');
    banner.hidden = true;
    layout.append(head, field);
    root.append(layout, toast, live, banner);
    host.append(root);

    const holes: Hole[] = Array.from({ length: HOLES }, (_, index) => {
        const button = el('button', 'kq-whack__hole');
        button.type = 'button';
        button.dataset.hole = String(index);
        button.setAttribute('aria-disabled', 'true');
        const pit = el('span', 'kq-whack__pit');
        const mole = el('span', 'kq-whack__mole');
        // 牌子與打對、打錯的標記放在同一層，標記才會貼在牌子的角落
        const tag = el('span', 'kq-whack__tag');
        const sign = el('span', 'kq-whack__sign');
        tag.append(sign, el('span', 'kq-whack__mark'));
        mole.append(tag);
        mole.insertAdjacentHTML('beforeend', CRITTER);
        pit.append(mole);
        button.append(pit, el('span', 'kq-whack__key', String(index + 1)));
        // 按下去就算打到，不等放開：小朋友敲得快，也不會因為手指滑動而沒算到
        button.addEventListener('pointerdown', (event) => {
            if (event.button === 0) {
                event.preventDefault();
                whack(index);
            }
        });
        // 鍵盤按 Enter、空白鍵（detail 為 0）；滑鼠與手指已經在 pointerdown 處理過
        button.addEventListener('click', (event) => {
            if (event.detail === 0) {
                whack(index);
            }
        });
        field.append(button);
        return { button, sign, state: 'down', optionId: null };
    });

    function later(fn: () => void, ms: number): void {
        const timer = setTimeout(() => {
            timers.delete(timer);
            fn();
        }, ms);
        timers.add(timer);
    }

    function clearTimers(): void {
        for (const timer of timers) {
            clearTimeout(timer);
        }
        timers.clear();
    }

    function setHole(index: number, state: HoleState): void {
        const hole = holes[index];
        hole.state = state;
        hole.button.classList.toggle('is-up', state !== 'down');
        hole.button.classList.toggle('is-hit', state === 'hit');
        hole.button.classList.toggle('is-miss', state === 'miss');
        hole.button.setAttribute('aria-disabled', String(state !== 'up'));
        const mark = hole.button.querySelector('.kq-whack__mark');
        if (mark) {
            mark.textContent =
                state === 'hit' ? '✓' : state === 'miss' ? '✗' : '';
        }
        if (state === 'down') {
            hole.optionId = null;
            delete hole.button.dataset.optionId;
            hole.button.removeAttribute('aria-label');
        }
    }

    function allDown(): void {
        for (const [index, hole] of holes.entries()) {
            if (hole.state !== 'down') {
                setHole(index, 'down');
            }
        }
    }

    function renderStars(): void {
        stars.textContent = `★ ${session.stars}`;
    }

    function renderClock(): void {
        const seconds = Math.ceil(
            countdown.remaining(performance.now()) / 1000,
        );
        clock.textContent = `${seconds} 秒`;
        clock.classList.toggle('is-low', seconds <= LOW_SECONDS);
    }

    // 短暫顯示的提示；減少動態效果時沒有淡出的動畫，所以時間到就拿掉
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    function showToast(text: string): void {
        toast.textContent = text;
        toast.classList.remove('is-shown');
        // 重新觸發動畫
        void toast.offsetWidth;
        toast.classList.add('is-shown');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(
            () => toast.classList.remove('is-shown'),
            TOAST_MS,
        );
    }

    function popScore(index: number, delta: number): void {
        if (delta === 0) {
            return;
        }
        const pop = el(
            'span',
            `kq-whack__pop ${delta > 0 ? 'is-plus' : 'is-minus'}`,
            delta > 0 ? `+${delta}` : `−${-delta}`,
        );
        holes[index].button.append(pop);
        setTimeout(() => pop.remove(), 900);
        stars.classList.remove('is-up', 'is-down');
        void stars.offsetWidth;
        stars.classList.add(delta > 0 ? 'is-up' : 'is-down');
    }

    function playPrompt(): void {
        const audio = session.current?.prompt.audio;
        if (audio) {
            ctx.audio.stopAll();
            void ctx.audio.play(audio).catch(() => undefined);
        }
    }

    function showRound(): void {
        const round = session.current;
        if (!round) {
            return;
        }
        roundStartedAt = performance.now();
        wave++;
        clearTimers();
        allDown();
        firstOfRound = true;
        previousHadAnswer = true;

        prompt.dataset.entryId = round.entryId;
        prompt.replaceChildren(renderFace(round.prompt, 'kq-whack__face'));
        if (round.prompt.audio) {
            const replay = el('button', 'kq-whack__audio', '🔊');
            replay.type = 'button';
            replay.setAttribute('aria-label', '再聽一次');
            replay.addEventListener('click', playPrompt);
            prompt.append(replay);
        }

        if (session.lap !== shownLap) {
            shownLap = session.lap;
            lap.textContent = `第 ${session.lap + 1} 輪`;
            showToast('再一輪！地鼠變快了');
        }

        playPrompt();
        later(spawnWave, FIRST_WAVE_MS);
    }

    function spawnWave(): void {
        const round = session.current;
        if (!round || paused) {
            return;
        }
        const withAnswer = waveHasAnswer(
            firstOfRound,
            previousHadAnswer,
            ctx.rng,
        );
        firstOfRound = false;
        previousHadAnswer = withAnswer;
        const moles = pickWave(round, HOLES, {
            withAnswer,
            avoidHoles: lastHoles,
            rng: ctx.rng,
        });
        lastHoles = moles.map((mole) => mole.hole);
        const id = ++wave;
        pending = moles.length;
        const stay = upMs(options.speed, session.lap);

        for (const [i, mole] of moles.entries()) {
            const option = round.options.find((o) => o.id === mole.optionId);
            if (!option) {
                pending--;
                continue;
            }
            later(() => {
                const hole = holes[mole.hole];
                hole.optionId = option.id;
                hole.button.dataset.optionId = option.id;
                hole.button.setAttribute('aria-label', faceLabel(option.face));
                hole.sign.replaceChildren(
                    renderFace(option.face, 'kq-whack__face'),
                );
                setHole(mole.hole, 'up');
                later(() => {
                    if (id === wave && hole.state === 'up') {
                        retreat(mole.hole, id);
                    }
                }, stay);
            }, i * STAGGER_MS);
        }
    }

    // 地鼠縮回去；這一批都縮回去了，就冒出下一批
    function retreat(index: number, id: number): void {
        setHole(index, 'down');
        if (id !== wave) {
            return;
        }
        pending--;
        if (pending <= 0) {
            later(spawnWave, WAVE_GAP_MS);
        }
    }

    function whack(index: number): void {
        const hole = holes[index];
        if (paused || finished || hole.state !== 'up' || !hole.optionId) {
            return;
        }
        const round = session.current;
        const result = session.hit(hole.optionId);
        if (!round || !result) {
            return;
        }

        if (result.report) {
            ctx.emit({
                type: 'answered',
                entryId: result.entryId,
                selected: [result.selected],
                correct: result.correct,
                durationMs: Math.round(performance.now() - roundStartedAt),
            });
        }
        renderStars();
        popScore(index, result.delta);

        if (result.correct) {
            live.textContent = '答對了！';
            // 其他地鼠縮回去，停一下再換題
            wave++;
            clearTimers();
            for (const [other, h] of holes.entries()) {
                if (other !== index && h.state !== 'down') {
                    setHole(other, 'down');
                }
            }
            setHole(index, 'hit');
            later(showRound, HIT_PAUSE_MS);
        } else {
            live.textContent = '不對，再找找看';
            setHole(index, 'miss');
            const id = wave;
            later(() => {
                if (hole.state === 'miss') {
                    retreat(index, id);
                }
            }, MISS_MS);
        }
    }

    function tick(): void {
        renderClock();
        if (countdown.remaining(performance.now()) <= 0) {
            timeUp();
        }
    }

    function startClock(): void {
        countdown.start(performance.now());
        clearInterval(tickTimer);
        tickTimer = setInterval(tick, TICK_MS);
        renderClock();
    }

    function stopClock(): void {
        countdown.pause(performance.now());
        clearInterval(tickTimer);
        tickTimer = undefined;
    }

    function timeUp(): void {
        if (finished) {
            return;
        }
        finished = true;
        finalElapsed = Math.min(
            countdown.totalMs,
            countdown.elapsed(performance.now()),
        );
        stopClock();
        session.end();
        wave++;
        clearTimers();
        allDown();
        ctx.audio.stopAll();
        renderClock();
        banner.replaceChildren(
            el('span', 'kq-whack__banner-title', '時間到！'),
            el('span', 'kq-whack__banner-stars', `★ ${session.stars}`),
        );
        banner.hidden = false;
        live.textContent = `時間到！得到 ${session.stars} 顆星星`;
        endTimer = setTimeout(complete, END_MS);
    }

    function complete(): void {
        endTimer = undefined;
        ctx.emit({
            type: 'completed',
            gameScore: session.stars,
            durationMs: Math.round(finalElapsed),
        });
    }

    function onKey(event: KeyboardEvent): void {
        if (event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }
        if (/^[1-9]$/.test(event.key)) {
            whack(Number(event.key) - 1);
        }
    }

    document.addEventListener('keydown', onKey);
    ctx.emit({ type: 'started' });
    renderStars();

    if (session.rounds.length === 0) {
        finished = true;
        complete();
    } else {
        startClock();
        showRound();
    }

    return {
        destroy() {
            clearTimers();
            clearInterval(tickTimer);
            clearTimeout(endTimer);
            clearTimeout(toastTimer);
            document.removeEventListener('keydown', onKey);
            ctx.audio.stopAll();
            root.remove();
        },
        // 宿主在分頁被藏起來時暫停：倒數停住、地鼠都縮回去，回來時重新出這一題
        pause() {
            if (paused) {
                return;
            }
            paused = true;
            if (finished) {
                if (endTimer !== undefined) {
                    clearTimeout(endTimer);
                    endTimer = undefined;
                }
                return;
            }
            stopClock();
            wave++;
            clearTimers();
            allDown();
            ctx.audio.stopAll();
        },
        resume() {
            if (!paused) {
                return;
            }
            paused = false;
            if (finished) {
                endTimer ??= setTimeout(complete, END_MS / 2);
                return;
            }
            startClock();
            showRound();
        },
    };
}

export const whackAMole: GameModule<WhackAMoleOptions> = { ...meta, mount };
export default whackAMole;
