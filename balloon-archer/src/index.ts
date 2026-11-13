import {
    Countdown,
    MAX_TARGETS,
    StarSession,
    mcqRounds,
    pickWave,
    waveHasAnswer,
} from '@kancil-quiz/arcade';
import type {
    Face,
    GameContext,
    GameInstance,
    GameModule,
} from '@kancil-quiz/games-sdk';
import { meta, normalizeOptions } from './meta';
import type { BalloonArcherOptions } from './meta';
import {
    arrowSpeed,
    clampY,
    firstHit,
    laneCount,
    laneX,
    pullAt,
    riseMs,
} from './session';
import type { Ellipse } from './session';
import './style.css';

export type { BalloonArcherOptions } from './meta';

/** 同一批的氣球依序飄上來的間隔（最少）；氣球大、飄得慢時拉長，上下至少隔一顆氣球的高度 */
const STAGGER_MS = 700;
/** 每顆氣球的速度在平均的 ±15% 之間，高度才會慢慢錯開，後面的氣球不會一直被前面的擋住 */
const SPEED_SPREAD = 0.15;
/** 這一批都飄過遊戲區的這個高度（從上面算起的比例）以上，就放下一批 */
const NEXT_WAVE_LINE = 0.45;
/** 下一批出發前停一下 */
const WAVE_GAP_MS = 250;
/** 換題之後先看題目，再放第一批 */
const FIRST_WAVE_MS = 400;
/** 射中正解之後停一下再換題 */
const HIT_PAUSE_MS = 650;
/** 「時間到」顯示多久才結束 */
const END_MS = 1800;
const TICK_MS = 200;
/** 剩幾秒時倒數變成紅色 */
const LOW_SECONDS = 10;
/** 「再一輪」的提示顯示多久 */
const TOAST_MS = 1600;
/** 空中最多同時幾支箭 */
const MAX_ARROWS = 3;
/** 鍵盤每按一下，弓箭手移動遊戲區高度的多少 */
const KEY_STEP = 0.05;
/** 鍵盤移動之後，瞄準線顯示多久 */
const KEY_GUIDE_MS = 1500;
/** 弓的中心在弓箭手那一格的高度比例（style.css 的 .kq-archer__bow 也照這個放） */
const BOW_AT = 0.45;
/** 氣球的顏色有幾種（.kq-archer__balloon--0 到 --5） */
const COLORS = 6;

// 弓箭手、弓與箭的樣子（不用圖檔）。弓朝右，箭水平往右射
const HERO = `<svg class="kq-archer__hero" viewBox="0 0 100 100" aria-hidden="true">
<rect x="4" y="94" width="92" height="6" rx="2" fill="#8b5a2b"/>
<rect x="20" y="40" width="9" height="34" rx="3" transform="rotate(-14 24 57)" fill="#8b5a2b"/>
<path d="M17 38l3-8 3 8M22 39l3-8 3 8" stroke="#c0392b" stroke-width="2.5" fill="none"/>
<rect x="38" y="78" width="9" height="16" rx="3" fill="#6b4423"/>
<rect x="53" y="78" width="9" height="16" rx="3" fill="#6b4423"/>
<path d="M33 50h34l5 32H28z" fill="#2f7d32"/>
<rect x="30" y="68" width="40" height="5" fill="#6b4423"/>
<path d="M64 54l20-8" stroke="#f2c9a0" stroke-width="6" stroke-linecap="round"/>
<circle cx="50" cy="37" r="13" fill="#f2c9a0"/>
<path d="M30 34q4-22 34-14l-4 9q-14-6-26 6z" fill="#2f7d32"/>
<path d="M56 22q10-12 20-12q-6 8-18 15z" fill="#c0392b"/>
<circle cx="52" cy="38" r="1.8" fill="#1f1a17"/>
<circle cx="60" cy="38" r="1.8" fill="#1f1a17"/>
<path d="M53 44q4 3 8 0" stroke="#1f1a17" stroke-width="1.4" fill="none" stroke-linecap="round"/>
</svg>`;

const BOW = `<svg class="kq-archer__bow" viewBox="-50 -50 100 100" aria-hidden="true">
<path d="M8-42Q48 0 8 42" stroke="#8b5a2b" stroke-width="5" fill="none" stroke-linecap="round"/>
<polyline class="kq-archer__string" points="8,-42 8,0 8,42" stroke="#f5f0e6" stroke-width="1.6" fill="none"/>
<g class="kq-archer__nock">
<path d="M8 0h40" stroke="#6b4423" stroke-width="3"/>
<path d="M46-5l10 5-10 5z" fill="#5f6b73"/>
<path d="M8 0l-6-5M8 0l-6 5M13 0l-6-5M13 0l-6 5" stroke="#c0392b" stroke-width="2"/>
</g>
</svg>`;

const ARROW = `<svg viewBox="0 0 60 12" preserveAspectRatio="none" aria-hidden="true">
<path d="M3 6h46" stroke="#6b4423" stroke-width="3"/>
<path d="M47 1l13 5-13 5z" fill="#5f6b73"/>
<path d="M3 6l-3-5M3 6l-3 5M8 6l-3-5M8 6l-3 5" stroke="#c0392b" stroke-width="2"/>
</svg>`;

const STRING = `<svg class="kq-archer__tail" viewBox="0 0 10 40" preserveAspectRatio="none" aria-hidden="true">
<path d="M5 0q-4 10 0 20t0 20" stroke="#6b7280" stroke-width="1.2" fill="none"/>
</svg>`;

interface Balloon {
    el: HTMLElement;
    optionId: string;
    wave: number;
    /** 跑道上的位置（不含左右搖晃） */
    x: number;
    /** 氣球本體的中心 */
    y: number;
    /** 每秒往上飄多遠 */
    vy: number;
    w: number;
    h: number;
    phase: number;
}

interface Arrow {
    el: HTMLElement;
    /** 箭頭的位置 */
    x: number;
    y: number;
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
        const img = el('img', 'kq-archer__image');
        img.src = face.image;
        img.alt = face.text ?? '';
        img.draggable = false;
        // 圖片載入失敗時只留文字，不讓畫面壞掉
        img.addEventListener('error', () => img.remove(), { once: true });
        box.append(img);
    }
    if (face.text) {
        const text = el('span', 'kq-archer__text', face.text);
        if (face.lang) {
            text.lang = face.lang;
        }
        box.append(text);
    }
    return box;
}

function mount(
    host: HTMLElement,
    ctx: GameContext<BalloonArcherOptions>,
): GameInstance {
    const options = normalizeOptions(ctx.options);
    const session = new StarSession(mcqRounds(ctx.rounds), ctx.rng);
    const countdown = new Countdown(options.seconds * 1000);
    const reducedMotion =
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ??
        false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let tickTimer: ReturnType<typeof setInterval> | undefined;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    let guideTimer: ReturnType<typeof setTimeout> | undefined;
    let frameId = 0;
    let lastFrame = performance.now();
    let finished = false;
    let finalElapsed = 0;
    let roundStartedAt = performance.now();
    let shownLap = 0;

    // 宿主暫停（分頁被藏起來）或畫面是直的時候，遊戲停住：倒數、氣球與箭都不動
    let hostPaused = false;
    let portrait = false;
    let active = false;
    let needRound = true;

    // 氣球一批一批飄上來；wave 每換一批（或換題）就加一，舊的計時器看到不同的 wave 就不動作
    let wave = 0;
    let pendingSpawns = 0;
    let waveQueued = false;
    let transitioning = false;
    let lastLanes: number[] = [];
    let firstOfRound = true;
    let previousHadAnswer = true;
    let maxBalloonWidth = 0;
    let maxBalloonHeight = 0;
    let balloons: Balloon[] = [];
    let arrows: Arrow[] = [];

    // 遊戲區的大小、弓的位置與弓箭手能站的高度，畫面大小改變時重新量
    let width = 0;
    let height = 0;
    let groundTop = 0;
    let bowX = 0;
    let minY = 0;
    let maxY = 0;
    let speed = 0;
    let arrowLength = 48;

    // 弓箭手的高度（弓的中心）。滑鼠、觸控按在哪個高度就站在哪裡，按住時跟著上下移動；
    // 按住（鍵盤是按住空白鍵）就拉弓，放開就射
    let bowY = 0;
    let pull = 0;
    /** 正在拉弓：哪個滑鼠或手指（鍵盤是 null）、從什麼時候開始按住 */
    let draw: { pointerId: number | null; since: number } | null = null;

    const root = el('div', 'kq-archer');
    root.lang = ctx.language;
    const layout = el('div', 'kq-archer__layout');
    const head = el('div', 'kq-archer__head');
    const status = el('div', 'kq-archer__status');
    const stars = el('span', 'kq-archer__stars');
    const lap = el('span', 'kq-archer__lap');
    const clock = el('span', 'kq-archer__timer');
    status.append(stars, lap, clock);
    const prompt = el('div', 'kq-archer__prompt');
    head.append(status, prompt);

    const field = el('div', 'kq-archer__field');
    const sky = el('div', 'kq-archer__sky');
    const guide = el('div', 'kq-archer__guide');
    guide.hidden = true;
    const ground = el('div', 'kq-archer__ground');
    const pole = el('div', 'kq-archer__pole');
    const player = el('div', 'kq-archer__player');
    player.insertAdjacentHTML('beforeend', HERO + BOW);
    const bow = player.querySelector<SVGElement>('.kq-archer__bow');
    const bowString =
        player.querySelector<SVGPolylineElement>('.kq-archer__string');
    const nock = player.querySelector<SVGGElement>('.kq-archer__nock');
    const hint = el('div', 'kq-archer__hint', '按住拉弓，放開就射箭');
    field.append(sky, guide, ground, pole, player, hint);

    const rotate = el('div', 'kq-archer__rotate');
    rotate.hidden = true;
    rotate.append(
        el('span', 'kq-archer__rotate-icon'),
        el('span', 'kq-archer__rotate-text', '請把手機或平板轉成橫的'),
    );
    const toast = el('div', 'kq-archer__toast');
    toast.setAttribute('aria-hidden', 'true');
    const live = el('div', 'kq-archer__live');
    live.setAttribute('role', 'status');
    const banner = el('div', 'kq-archer__banner');
    banner.hidden = true;
    layout.append(head, field);
    root.append(layout, toast, live, banner, rotate);
    host.append(root);

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
        pendingSpawns = 0;
        waveQueued = false;
    }

    function measure(): void {
        const oldWidth = width;
        const oldHeight = height;
        width = field.clientWidth;
        height = field.clientHeight;
        groundTop = ground.offsetTop;
        const playerHeight = player.offsetHeight;
        // 柱子在弓箭手的正下方（弓箭手站在那一格左邊 72% 的中間）
        pole.style.left = `${player.offsetLeft + player.offsetWidth * 0.36 - pole.offsetWidth / 2}px`;
        minY = playerHeight * BOW_AT + 4;
        maxY = groundTop - playerHeight * (1 - BOW_AT);
        // E2E 瞄準用：弓箭手能站的高度（放開就會射，不能先按下去試站不站得到）
        root.dataset.bowMin = String(Math.ceil(minY));
        root.dataset.bowMax = String(Math.floor(Math.max(minY, maxY)));
        const box = field.getBoundingClientRect();
        const bowBox = bow?.getBoundingClientRect();
        bowX = bowBox
            ? bowBox.left + bowBox.width / 2 - box.left
            : width * 0.12;
        speed = arrowSpeed(width);
        root.dataset.arrowSpeed = String(Math.round(speed));
        arrowLength = Math.round(
            Math.min(72, Math.max(36, Math.min(width, height) * 0.12)),
        );

        // 畫面大小改變：弓箭手與氣球照比例移到新的位置，飛在空中的箭拿掉
        if (oldWidth > 0 && oldHeight > 0) {
            bowY *= height / oldHeight;
            for (const balloon of balloons) {
                balloon.x *= width / oldWidth;
                balloon.y *= height / oldHeight;
                balloon.vy *= height / oldHeight;
            }
            clearArrows();
            measureRound();
        } else {
            bowY = (minY + maxY) / 2;
        }
        bowY = clampY(bowY, minY, maxY);
        renderBow();
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

    function renderBow(): void {
        player.style.transform = `translateY(${bowY - player.offsetHeight * BOW_AT}px)`;
        const back = 8 - pull * 22;
        bowString?.setAttribute('points', `8,-42 ${back},0 8,42`);
        nock?.setAttribute('transform', `translate(${back - 8} 0)`);
        // 空中的箭已經滿了、或時間到了，弓上就不搭箭
        if (nock) {
            nock.style.visibility =
                finished || arrows.length >= MAX_ARROWS ? 'hidden' : '';
        }
        guide.style.width = `${Math.max(0, width - bowX)}px`;
        guide.style.transform = `translate(${bowX}px, ${bowY}px)`;
    }

    function showGuide(visible: boolean): void {
        guide.hidden = !visible;
        renderBow();
    }

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

    function popScore(x: number, y: number, delta: number): void {
        if (delta === 0) {
            return;
        }
        const pop = el(
            'span',
            `kq-archer__pop ${delta > 0 ? 'is-plus' : 'is-minus'}`,
            delta > 0 ? `+${delta}` : `−${-delta}`,
        );
        pop.style.left = `${x}px`;
        pop.style.top = `${y}px`;
        field.append(pop);
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

    // 這一題最大的氣球有多寬、多高：寬度決定跑道數，同一批的氣球才不會左右疊在一起；
    // 高度決定同一批的氣球隔多久出發，上下才不會疊在一起
    function measureRound(): void {
        maxBalloonWidth = 0;
        maxBalloonHeight = 0;
        const round = session.current;
        if (!round) {
            return;
        }
        const probe = el('div', 'kq-archer__balloon is-probe');
        field.append(probe);
        for (const option of round.options) {
            const body = el('div', 'kq-archer__body');
            body.append(renderFace(option.face, 'kq-archer__face'));
            probe.replaceChildren(body);
            maxBalloonWidth = Math.max(maxBalloonWidth, body.offsetWidth);
            maxBalloonHeight = Math.max(maxBalloonHeight, body.offsetHeight);
        }
        probe.remove();
    }

    /** 這一輪氣球平均每秒往上飄多遠 */
    function riseSpeed(h: number): number {
        return (height + h * 2.5) / (riseMs(options.speed, session.lap) / 1000);
    }

    /** 氣球飄的範圍：弓箭手右邊的天空 */
    function skyStart(): number {
        return bowX + Math.max(60, width * 0.12);
    }

    function removeBalloon(balloon: Balloon, className: string): void {
        balloons = balloons.filter((b) => b !== balloon);
        balloon.el.classList.remove('is-flying');
        balloon.el.classList.add(className);
        balloon.el.removeAttribute('data-option-id');
        setTimeout(() => balloon.el.remove(), reducedMotion ? 0 : 450);
    }

    function clearArrows(): void {
        for (const arrow of arrows) {
            arrow.el.remove();
        }
        arrows = [];
        renderBow();
    }

    function showRound(): void {
        const round = session.current;
        if (!round) {
            return;
        }
        transitioning = false;
        needRound = false;
        roundStartedAt = performance.now();
        wave++;
        clearTimers();
        clearArrows();
        for (const balloon of balloons) {
            removeBalloon(balloon, 'is-leaving');
        }
        firstOfRound = true;
        previousHadAnswer = true;
        lastLanes = [];

        prompt.dataset.entryId = round.entryId;
        prompt.replaceChildren(renderFace(round.prompt, 'kq-archer__face'));
        if (round.prompt.audio) {
            const replay = el('button', 'kq-archer__audio', '🔊');
            replay.type = 'button';
            replay.setAttribute('aria-label', '再聽一次');
            replay.addEventListener('click', playPrompt);
            prompt.append(replay);
        }
        measureRound();

        if (session.lap !== shownLap) {
            shownLap = session.lap;
            lap.textContent = `第 ${session.lap + 1} 輪`;
            showToast('再一輪！氣球變快了');
        }

        playPrompt();
        waveQueued = true;
        later(() => {
            waveQueued = false;
            spawnWave();
        }, FIRST_WAVE_MS);
    }

    function spawnWave(): void {
        const round = session.current;
        if (!round || !active) {
            return;
        }
        const lanes = laneCount(width - skyStart(), maxBalloonWidth);
        const withAnswer = waveHasAnswer(
            firstOfRound,
            previousHadAnswer,
            ctx.rng,
        );
        firstOfRound = false;
        previousHadAnswer = withAnswer;
        const targets = pickWave(round, lanes, {
            withAnswer,
            avoidSlots: lastLanes,
            size: Math.min(MAX_TARGETS, lanes),
            rng: ctx.rng,
        });
        lastLanes = targets.map((target) => target.slot);
        const id = ++wave;
        pendingSpawns = targets.length;
        const stagger = Math.max(
            STAGGER_MS,
            ((maxBalloonHeight * 1.2) / riseSpeed(maxBalloonHeight)) * 1000,
        );

        for (const [i, target] of targets.entries()) {
            const option = round.options.find((o) => o.id === target.optionId);
            later(() => {
                pendingSpawns--;
                if (id === wave && option) {
                    launch(option.id, option.face, target.slot, lanes, id);
                }
            }, i * stagger);
        }
    }

    function launch(
        optionId: string,
        face: Face,
        lane: number,
        lanes: number,
        id: number,
    ): void {
        const node = el(
            'div',
            `kq-archer__balloon kq-archer__balloon--${Math.floor(ctx.rng() * COLORS)} is-flying`,
        );
        node.dataset.optionId = optionId;
        const body = el('div', 'kq-archer__body');
        body.append(renderFace(face, 'kq-archer__face'));
        node.append(body);
        node.insertAdjacentHTML('beforeend', STRING);
        sky.append(node);

        const w = body.offsetWidth;
        const h = body.offsetHeight;
        const start = skyStart();
        const laneWidth = (width - start) / lanes;
        const jitter = Math.max(0, (laneWidth - w) / 2) * (ctx.rng() - 0.5);
        const balloon: Balloon = {
            el: node,
            optionId,
            wave: id,
            x: laneX(lane, lanes, start, width) + jitter,
            // 從地面下面飄上來
            y: height + h / 2,
            vy:
                riseSpeed(h) *
                (1 - SPEED_SPREAD + ctx.rng() * SPEED_SPREAD * 2),
            w,
            h,
            phase: ctx.rng() * Math.PI * 2,
        };
        node.dataset.vy = String(Math.round(balloon.vy));
        balloons.push(balloon);
        place(balloon, performance.now());
    }

    function swayOf(balloon: Balloon, now: number): number {
        return reducedMotion
            ? 0
            : Math.sin(now / 650 + balloon.phase) * Math.min(8, width * 0.01);
    }

    function place(balloon: Balloon, now: number): void {
        const x = balloon.x + swayOf(balloon, now) - balloon.w / 2;
        balloon.el.style.transform = `translate(${x}px, ${balloon.y - balloon.h / 2}px)`;
    }

    function fire(): void {
        if (!active || finished || transitioning) {
            return;
        }
        if (arrows.length >= MAX_ARROWS) {
            return;
        }
        const node = el('div', 'kq-archer__arrow');
        node.insertAdjacentHTML('beforeend', ARROW);
        node.style.width = `${arrowLength}px`;
        node.style.height = `${Math.round(arrowLength / 5)}px`;
        field.insertBefore(node, ground);
        const arrow: Arrow = {
            el: node,
            x: bowX + arrowLength * 0.6,
            y: bowY,
        };
        arrows.push(arrow);
        placeArrow(arrow);
        hint.hidden = true;
        renderBow();
    }

    function placeArrow(arrow: Arrow): void {
        // 箭頭在 (x, y)：整支箭在箭頭的左邊
        arrow.el.style.transform = `translate(${arrow.x - arrowLength}px, ${arrow.y}px) translateY(-50%)`;
    }

    function hitBalloon(balloon: Balloon): void {
        const result = session.hit(balloon.optionId);
        if (!result) {
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
        popScore(balloon.x, balloon.y - balloon.h / 2, result.delta);
        removeBalloon(balloon, result.correct ? 'is-correct' : 'is-wrong');

        if (result.correct) {
            live.textContent = '射中了！';
            // 其他氣球飛走，停一下再換題
            transitioning = true;
            wave++;
            clearTimers();
            clearArrows();
            for (const other of balloons) {
                removeBalloon(other, 'is-leaving');
            }
            later(showRound, HIT_PAUSE_MS);
        } else {
            live.textContent = '不對，再找找看';
        }
    }

    function frame(now: number): void {
        frameId = requestAnimationFrame(frame);
        const dt = Math.min(0.05, Math.max(0, now - lastFrame) / 1000);
        lastFrame = now;
        if (!active) {
            return;
        }

        // 按住越久，弓弦拉得越開
        if (draw) {
            const next = pullAt(now - draw.since);
            if (next !== pull) {
                pull = next;
                renderBow();
            }
        }

        for (const balloon of balloons) {
            balloon.y -= balloon.vy * dt;
            if (balloon.y + balloon.h * 1.5 < 0) {
                balloons = balloons.filter((b) => b !== balloon);
                balloon.el.remove();
            } else {
                place(balloon, now);
            }
        }

        // 只有飄到地面上的氣球射得到
        const targets = balloons.filter((b) => b.y < groundTop);
        const ellipses: Ellipse[] = targets.map((b) => ({
            cx: b.x + swayOf(b, now),
            cy: b.y,
            rx: b.w / 2,
            ry: b.h / 2,
        }));
        for (const arrow of arrows) {
            const from = { x: arrow.x, y: arrow.y };
            arrow.x += speed * dt;
            const index = firstHit(from, arrow, ellipses);
            if (index >= 0 || arrow.x > width + arrowLength) {
                arrows = arrows.filter((a) => a !== arrow);
                arrow.el.remove();
                renderBow();
                if (index >= 0) {
                    hitBalloon(targets[index]);
                    if (transitioning) {
                        return;
                    }
                    ellipses[index] = { cx: 0, cy: 0, rx: 0, ry: 0 };
                }
            } else {
                placeArrow(arrow);
            }
        }

        // 這一批都飄過一半以上（或被射破了），就放下一批
        if (
            !transitioning &&
            !waveQueued &&
            pendingSpawns === 0 &&
            !balloons.some(
                (b) => b.wave === wave && b.y > height * NEXT_WAVE_LINE,
            )
        ) {
            waveQueued = true;
            later(() => {
                waveQueued = false;
                spawnWave();
            }, WAVE_GAP_MS);
        }
    }

    function pointerY(event: PointerEvent): number {
        return event.clientY - field.getBoundingClientRect().top;
    }

    // 開始拉弓（滑鼠、觸控是 pointerId，鍵盤是 null）
    function startDraw(pointerId: number | null): void {
        draw = { pointerId, since: performance.now() };
        pull = 0;
        showGuide(true);
    }

    // 不射就停止拉弓（宿主暫停、手指被系統取消、視窗失去焦點）
    function stopDraw(): void {
        draw = null;
        pull = 0;
        showGuide(false);
    }

    // 放開：不論拉了多久都射
    function release(): void {
        stopDraw();
        fire();
    }

    function onPointerDown(event: PointerEvent): void {
        // 已經在拉弓（另一根手指或空白鍵）時不理會
        if (!active || finished || event.button !== 0 || draw) {
            return;
        }
        event.preventDefault();
        field.setPointerCapture?.(event.pointerId);
        bowY = clampY(pointerY(event), minY, maxY);
        startDraw(event.pointerId);
    }

    function onPointerMove(event: PointerEvent): void {
        if (draw?.pointerId !== event.pointerId) {
            return;
        }
        bowY = clampY(pointerY(event), minY, maxY);
        renderBow();
    }

    function onPointerUp(event: PointerEvent): void {
        if (draw?.pointerId !== event.pointerId) {
            return;
        }
        bowY = clampY(pointerY(event), minY, maxY);
        release();
    }

    function onPointerCancel(event: PointerEvent): void {
        if (draw?.pointerId === event.pointerId) {
            stopDraw();
        }
    }

    // 鍵盤：↑ ↓ 移動弓箭手，按住空白鍵拉弓、放開就射
    function onKeyDown(event: KeyboardEvent): void {
        if (!active || finished || event.altKey || event.ctrlKey) {
            return;
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const step = height * KEY_STEP;
            bowY = clampY(
                bowY + (event.key === 'ArrowUp' ? -step : step),
                minY,
                maxY,
            );
            showGuide(true);
            clearTimeout(guideTimer);
            // 還按著空白鍵時，瞄準線留著
            guideTimer = setTimeout(() => {
                if (!draw) {
                    showGuide(false);
                }
            }, KEY_GUIDE_MS);
        } else if (
            event.key === ' ' &&
            // 焦點在按鈕（例如「再聽一次」）上時，空白鍵是按那個按鈕
            !(event.target instanceof HTMLButtonElement)
        ) {
            event.preventDefault();
            // 按住不放時鍵盤會一直重複送 keydown，只有第一次算
            if (!event.repeat && !draw) {
                startDraw(null);
            }
        }
    }

    function onKeyUp(event: KeyboardEvent): void {
        if (event.key === ' ' && draw?.pointerId === null) {
            event.preventDefault();
            release();
        }
    }

    // 按著空白鍵切到別的視窗，就收不到放開的 keyup：取消拉弓，不射
    function onBlur(): void {
        if (draw?.pointerId === null) {
            stopDraw();
        }
    }

    function tick(): void {
        renderClock();
        if (countdown.remaining(performance.now()) <= 0) {
            timeUp();
        }
    }

    // 開始或停住：宿主沒有暫停、畫面是橫的、還沒結束時才進行
    function sync(): void {
        const want = !hostPaused && !portrait && !finished;
        if (want === active) {
            return;
        }
        active = want;
        const now = performance.now();
        if (active) {
            countdown.start(now);
            clearInterval(tickTimer);
            tickTimer = setInterval(tick, TICK_MS);
            renderClock();
            lastFrame = now;
            cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(frame);
            // 第一題，或停住時正要換題（換題的計時器已經清掉）
            if (needRound || transitioning) {
                showRound();
            }
        } else {
            countdown.pause(now);
            clearInterval(tickTimer);
            tickTimer = undefined;
            cancelAnimationFrame(frameId);
            clearTimers();
            stopDraw();
            ctx.audio.stopAll();
        }
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
        sync();
        session.end();
        wave++;
        clearArrows();
        for (const balloon of balloons) {
            removeBalloon(balloon, 'is-leaving');
        }
        renderClock();
        banner.replaceChildren(
            el('span', 'kq-archer__banner-title', '時間到！'),
            el('span', 'kq-archer__banner-stars', `★ ${session.stars}`),
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

    // 固定橫式版面：遊戲區是直的（比寬還高）時蓋一層「請轉成橫的」，遊戲停住
    function checkOrientation(): void {
        const next = root.clientHeight > root.clientWidth;
        if (next !== portrait) {
            portrait = next;
            rotate.hidden = !portrait;
            sync();
        }
    }

    field.addEventListener('pointerdown', onPointerDown);
    field.addEventListener('pointermove', onPointerMove);
    field.addEventListener('pointerup', onPointerUp);
    field.addEventListener('pointercancel', onPointerCancel);
    // 長按時不跳出選單（Android、Windows 觸控的長按，以及滑鼠右鍵）
    field.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    const resize = new ResizeObserver(() => {
        checkOrientation();
        measure();
    });
    resize.observe(root);
    resize.observe(field);

    ctx.emit({ type: 'started' });
    renderStars();
    renderClock();
    measure();

    if (session.rounds.length === 0) {
        finished = true;
        complete();
    } else {
        portrait = root.clientHeight > root.clientWidth;
        rotate.hidden = !portrait;
        sync();
    }

    return {
        destroy() {
            cancelAnimationFrame(frameId);
            clearTimers();
            clearInterval(tickTimer);
            clearTimeout(endTimer);
            clearTimeout(toastTimer);
            clearTimeout(guideTimer);
            resize.disconnect();
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
            ctx.audio.stopAll();
            root.remove();
        },
        // 宿主在分頁被藏起來時暫停：倒數、氣球與箭都停住，回來時接著飄
        pause() {
            hostPaused = true;
            if (finished && endTimer !== undefined) {
                clearTimeout(endTimer);
                endTimer = undefined;
            }
            sync();
        },
        resume() {
            hostPaused = false;
            if (finished) {
                endTimer ??= setTimeout(complete, END_MS / 2);
                return;
            }
            sync();
        },
    };
}

export const balloonArcher: GameModule<BalloonArcherOptions> = {
    ...meta,
    mount,
};
export default balloonArcher;
