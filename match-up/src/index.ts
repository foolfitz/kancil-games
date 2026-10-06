import type {
    Face,
    GameContext,
    GameInstance,
    GameModule,
} from '@kancil-quiz/games-sdk';
import { meta } from './meta';
import type { MatchUpOptions } from './meta';
import { MatchSession, fitPairsPerPage, pairRounds } from './session';
import type { PairRound } from './session';
import './style.css';

export type { MatchUpOptions } from './meta';

// 移動超過這個距離（px）才算拖曳，否則當成點選
const DRAG_THRESHOLD = 8;
const WRONG_FLASH_MS = 700;
const NEXT_PAGE_DELAY_MS = 1000;
// 遊戲區的寬或高改變超過這麼多 px 才重新分頁（轉向、調整視窗、分割畫面）；
// 更小的變動（捲軸出現、手機的網址列）不理，免得玩到一半卡片重排
const REFIT_MIN_CHANGE_PX = 32;
// 轉向時尺寸會連續變動幾次，等它停下來再量
const REFIT_DEBOUNCE_MS = 150;

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
        const img = el('img', 'kq-match__image');
        img.src = face.image;
        img.alt = face.text ?? '';
        img.draggable = false;
        // 圖片載入失敗時只留文字，不讓畫面壞掉
        img.addEventListener('error', () => img.remove(), { once: true });
        box.append(img);
    }
    const words = el('span', 'kq-match__words');
    if (face.text) {
        words.append(el('span', 'kq-match__text', face.text));
    }
    if (face.romanization) {
        words.append(el('span', 'kq-match__romanization', face.romanization));
    }
    if (words.childElementCount > 0) {
        box.append(words);
    }
    return box;
}

interface Drag {
    card: HTMLButtonElement;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
}

function mount(
    host: HTMLElement,
    ctx: GameContext<MatchUpOptions>,
): GameInstance {
    const options = { ...meta.defaultOptions, ...ctx.options };
    const rounds = pairRounds(ctx.rounds);
    // 每頁幾組要等畫面建好、量過放不放得下才確定（見下方 fit()）
    const session = new MatchSession(rounds, options.pairsPerPage, ctx.rng);
    const startedAt = performance.now();
    let lastAnswerAt = startedAt;
    let paused = false;
    let finished = false;
    let pendingNextPage = false;
    let nextPageTimer: ReturnType<typeof setTimeout> | undefined;
    let selected: HTMLButtonElement | null = null;
    let drag: Drag | null = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    // 上一次決定每頁組數時遊戲區的大小；尺寸改變時正在拖曳或正要換頁，等結束再重新分頁
    let fittedWidth = 0;
    let fittedHeight = 0;
    let refitTimer: ReturnType<typeof setTimeout> | undefined;
    let refitWanted = false;

    const later = (callback: () => void, ms: number) => {
        const id = setTimeout(() => {
            timers.delete(id);
            callback();
        }, ms);
        timers.add(id);
    };

    const root = el('div', 'kq-match');
    root.lang = ctx.language;
    const status = el('div', 'kq-match__status');
    const progress = el('span', 'kq-match__progress');
    const feedback = el('span', 'kq-match__feedback');
    feedback.setAttribute('role', 'status');
    status.append(progress, feedback);
    const board = el('div', 'kq-match__board');
    const rows = el('div', 'kq-match__rows');
    const pool = el('div', 'kq-match__pool');
    pool.setAttribute('aria-label', '答案卡片');
    board.append(rows, pool);
    const layout = el('div', 'kq-match__layout');
    layout.append(status, board);
    root.append(layout);
    host.append(root);

    function say(text: string, tone: 'correct' | 'wrong' | 'info'): void {
        feedback.textContent = text;
        feedback.className = `kq-match__feedback is-${tone}`;
    }

    function updateProgress(): void {
        const page = session.page;
        if (!page) {
            return;
        }
        const done = page.slots.filter((slot) =>
            session.isMatched(slot.entryId),
        ).length;
        const pages =
            session.pages.length > 1
                ? `第 ${session.pageIndex + 1} / ${session.pages.length} 頁｜`
                : '';
        progress.textContent = `${pages}配好 ${done} / ${page.slots.length} 組`;
    }

    function rowAt(x: number, y: number): HTMLElement | null {
        for (const row of rows.querySelectorAll<HTMLElement>(
            '.kq-match__row',
        )) {
            const rect = row.getBoundingClientRect();
            if (
                x >= rect.left &&
                x <= rect.right &&
                y >= rect.top &&
                y <= rect.bottom
            ) {
                return row;
            }
        }
        return null;
    }

    function highlight(row: HTMLElement | null): void {
        for (const other of rows.querySelectorAll('.kq-match__row.is-over')) {
            if (other !== row) {
                other.classList.remove('is-over');
            }
        }
        row?.classList.add('is-over');
    }

    function select(card: HTMLButtonElement | null): void {
        selected?.classList.remove('is-selected');
        selected?.setAttribute('aria-pressed', 'false');
        selected = card;
        card?.classList.add('is-selected');
        card?.setAttribute('aria-pressed', 'true');
        root.classList.toggle('has-selection', card !== null);
    }

    // 卡片回到原位：拖曳時以動畫滑回去，點選時搖一下
    function returnCard(card: HTMLButtonElement, dragged: boolean): void {
        if (dragged) {
            card.classList.add('is-returning');
            card.style.transform = '';
            later(() => card.classList.remove('is-returning'), 250);
        } else {
            card.classList.remove('is-shaking');
            void card.offsetWidth;
            card.classList.add('is-shaking');
            later(() => card.classList.remove('is-shaking'), 400);
        }
    }

    function attempt(
        card: HTMLButtonElement,
        row: HTMLElement,
        dragged: boolean,
    ): void {
        const cardId = card.dataset.entryId ?? '';
        const slotId = row.dataset.entryId ?? '';
        const result = session.place(cardId, slotId);
        select(null);
        if (!result) {
            returnCard(card, dragged);
            return;
        }

        const now = performance.now();
        ctx.emit({
            type: 'answered',
            entryId: result.entryId,
            selected: [result.selected],
            correct: result.correct,
            durationMs: Math.round(now - lastAnswerAt),
            presented: result.presented,
        });
        lastAnswerAt = now;

        if (!result.correct) {
            returnCard(card, dragged);
            row.classList.remove('is-wrong');
            void row.offsetWidth;
            row.classList.add('is-wrong');
            later(() => row.classList.remove('is-wrong'), WRONG_FLASH_MS);
            say('✗ 不對，再試一次', 'wrong');
            return;
        }

        // 配好的卡片放進那一題；原位留下看不見的空位，其他卡片不會跟著移動
        const slot = session.page?.slots.find(
            (candidate) => candidate.entryId === slotId,
        );
        if (slot) {
            placeInto(row, slot, false);
        }
        card.style.transform = '';
        card.classList.remove('is-dragging');
        card.classList.add('is-used');
        card.disabled = true;
        card.tabIndex = -1;
        card.setAttribute('aria-hidden', 'true');

        const audio = slot?.left.audio;
        if (audio) {
            ctx.audio.stopAll();
            void ctx.audio.play(audio).catch(() => undefined);
        }

        updateProgress();
        if (result.pageComplete) {
            say(
                session.pageIndex + 1 < session.pages.length
                    ? '✓ 這一頁完成了！'
                    : '✓ 全部配好了！',
                'correct',
            );
            pendingNextPage = true;
            if (!paused) {
                nextPageTimer = setTimeout(nextPage, NEXT_PAGE_DELAY_MS);
            }
        } else {
            say('✓ 配對正確', 'correct');
        }
    }

    function nextPage(): void {
        pendingNextPage = false;
        session.nextPage();
        if (session.finished) {
            finish();
        } else {
            startPage();
        }
    }

    function finish(): void {
        if (finished) {
            return;
        }
        finished = true;
        ctx.audio.stopAll();
        ctx.emit({
            type: 'completed',
            gameScore: session.score,
            durationMs: Math.round(performance.now() - startedAt),
        });
    }

    // 配好的卡片放進那一題旁邊的空格，不能再拖。重新畫這一頁（轉向後重新分頁）時放回去的
    // 不再播放放上去的動畫
    function placeInto(
        row: HTMLElement,
        slot: PairRound,
        restored: boolean,
    ): void {
        const placed = el('button', 'kq-match__card is-placed');
        placed.type = 'button';
        placed.disabled = true;
        placed.dataset.entryId = slot.entryId;
        placed.classList.toggle('is-restored', restored);
        placed.append(renderFace(slot.right, 'kq-match__face'));
        row.querySelector('.kq-match__zone')?.replaceChildren(
            placed,
            el('span', 'kq-match__mark', '✓'),
        );
        row.classList.add('is-matched');
    }

    function renderRow(slot: PairRound): HTMLElement {
        const row = el('div', 'kq-match__row');
        row.dataset.entryId = slot.entryId;
        const prompt = renderFace(slot.left, 'kq-match__prompt');
        if (slot.left.audio) {
            const audio = slot.left.audio;
            const play = el('button', 'kq-match__audio', '🔊');
            play.type = 'button';
            play.setAttribute('aria-label', '播放發音');
            play.addEventListener('click', (event) => {
                event.stopPropagation();
                if (!paused) {
                    ctx.audio.stopAll();
                    void ctx.audio.play(audio).catch(() => undefined);
                }
            });
            prompt.append(play);
        }
        const zone = el('div', 'kq-match__zone');
        const drop = el('button', 'kq-match__drop', '放到這裡');
        drop.type = 'button';
        zone.append(drop);
        row.append(prompt, zone);
        if (session.isMatched(slot.entryId)) {
            placeInto(row, slot, true);
        }
        // 點選模式：先點卡片，再點這一題（整列都可以點）
        row.addEventListener('click', () => {
            if (paused || finished || row.classList.contains('is-matched')) {
                return;
            }
            if (selected) {
                attempt(selected, row, false);
            } else {
                say('先點一張卡片，再點這裡；也可以直接把卡片拖過來', 'info');
            }
        });
        return row;
    }

    function renderCard(card: PairRound): HTMLElement {
        const button = el('button', 'kq-match__card');
        button.type = 'button';
        button.dataset.entryId = card.entryId;
        button.setAttribute('aria-pressed', 'false');
        button.append(renderFace(card.right, 'kq-match__face'));

        // 剛拖曳過：拖曳結束後瀏覽器可能還會對這張卡片送出 click，不要把它當成點選。
        // 下一次按下時清除；鍵盤觸發的 click（detail 為 0）不受影響
        let justDragged = false;

        button.addEventListener('click', (event) => {
            if (paused || finished) {
                return;
            }
            if (event.detail > 0 && justDragged) {
                justDragged = false;
                return;
            }
            select(selected === button ? null : button);
        });
        button.addEventListener('pointerdown', (event) => {
            justDragged = false;
            if (
                paused ||
                finished ||
                button.disabled ||
                drag ||
                (event.pointerType === 'mouse' && event.button !== 0)
            ) {
                return;
            }
            drag = {
                card: button,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                active: false,
            };
            button.setPointerCapture?.(event.pointerId);
        });
        button.addEventListener('pointermove', (event) => {
            if (drag?.card !== button || drag.pointerId !== event.pointerId) {
                return;
            }
            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            if (!drag.active) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) {
                    return;
                }
                drag.active = true;
                select(null);
                button.classList.add('is-dragging');
            }
            button.style.transform = `translate(${dx}px, ${dy}px)`;
            highlight(rowAt(event.clientX, event.clientY));
        });
        const endDrag = (event: PointerEvent, cancelled: boolean) => {
            if (drag?.card !== button || drag.pointerId !== event.pointerId) {
                return;
            }
            const wasActive = drag.active;
            drag = null;
            if (wasActive) {
                justDragged = true;
                button.classList.remove('is-dragging');
                highlight(null);
                const row = cancelled
                    ? null
                    : rowAt(event.clientX, event.clientY);
                if (row && !paused) {
                    attempt(button, row, true);
                } else {
                    returnCard(button, true);
                }
            }
            // 拖曳時畫面大小改變了：現在才重新分頁
            if (refitWanted) {
                refitIfNeeded();
            }
        };
        button.addEventListener('pointerup', (event) => endDrag(event, false));
        button.addEventListener('pointercancel', (event) =>
            endDrag(event, true),
        );
        return button;
    }

    // 畫出這一頁，包括已經配好的題目。配好的卡片不放回卡片區：玩的時候留下空位是為了其他卡片
    // 不要移動，重新畫整頁時沒有這個問題，少占一點位置
    function renderPage(): void {
        const page = session.page;
        if (!page) {
            return;
        }
        select(null);
        rows.replaceChildren(...page.slots.map(renderRow));
        pool.replaceChildren(
            ...page.cards
                .filter((card) => !session.isMatched(card.entryId))
                .map(renderCard),
        );
        updateProgress();
    }

    // 新的一頁：畫出來、依畫面大小決定組數，重新計時
    function startPage(): void {
        renderPage();
        fit();
        say('把卡片拖到對應的題目', 'info');
        lastAnswerAt = performance.now();
    }

    // 這一頁的題目與卡片是不是都在畫面內（沒有掛在版面上時量不到，就當作放得下）
    // 手機橫放時題目排成一排（style.css），放不下的是寬度，所以兩個方向都要量
    function fitsScreen(): boolean {
        return (
            root.clientHeight === 0 ||
            (root.scrollHeight <= root.clientHeight + 1 &&
                root.scrollWidth <= root.clientWidth + 1)
        );
    }

    // 老師設定的是每頁「最多」幾組：手機等小畫面放不下時減少組數，讓同一頁的題目與卡片
    // 都在畫面內，拖曳時不必捲動（docs/SPEC.md 7.5）。每試一種組數就重新分頁、畫出來量一次
    // （進度照舊，見 MatchSession.refit()）；試到最後分頁和原本一樣時換回原本的，卡片的順序才不會變
    function fit(): void {
        refitWanted = false;
        const before = session.layout;
        let changed = false;
        fitPairsPerPage(options.pairsPerPage, (perPage) => {
            if (session.refit(perPage, ctx.rng)) {
                changed = true;
                renderPage();
            }
            return fitsScreen();
        });
        if (changed && session.sameLayout(before)) {
            session.restore(before);
            renderPage();
        }
        fittedWidth = root.clientWidth;
        fittedHeight = root.clientHeight;
    }

    // 遊戲區的大小改變了（轉向、調整視窗）：變動夠大才重新分頁；拖曳中或這一頁剛配完、
    // 正要換頁時先不動，等拖曳結束或下一頁出現再做（下一頁本來就會重新量）
    function refitIfNeeded(): void {
        clearTimeout(refitTimer);
        refitTimer = undefined;
        if (finished || session.finished || root.clientHeight === 0) {
            return;
        }
        if (
            Math.abs(root.clientWidth - fittedWidth) < REFIT_MIN_CHANGE_PX &&
            Math.abs(root.clientHeight - fittedHeight) < REFIT_MIN_CHANGE_PX
        ) {
            return;
        }
        if (drag || pendingNextPage) {
            refitWanted = true;
            return;
        }
        fit();
    }

    // 量的是遊戲自己的根元素（和 CSS 的 container 一樣）；它的大小由宿主的遊戲區決定，
    // 不隨內容改變，重新分頁不會再觸發一次。觀察前先量好第一次的大小，第一次的回呼才不會算成改變
    const resize =
        typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(() => {
                  clearTimeout(refitTimer);
                  refitTimer = setTimeout(refitIfNeeded, REFIT_DEBOUNCE_MS);
              });

    function onKey(event: KeyboardEvent): void {
        if (event.key === 'Escape' && selected) {
            select(null);
        }
    }
    document.addEventListener('keydown', onKey);

    ctx.emit({ type: 'started' });
    if (session.finished) {
        finish();
    } else {
        startPage();
        resize?.observe(root);
    }

    return {
        destroy() {
            resize?.disconnect();
            clearTimeout(refitTimer);
            clearTimeout(nextPageTimer);
            for (const id of timers) {
                clearTimeout(id);
            }
            timers.clear();
            document.removeEventListener('keydown', onKey);
            ctx.audio.stopAll();
            root.remove();
        },
        pause() {
            paused = true;
            ctx.audio.stopAll();
            if (drag?.active) {
                drag.card.classList.remove('is-dragging');
                returnCard(drag.card, true);
                highlight(null);
            }
            drag = null;
            clearTimeout(nextPageTimer);
            // 拖曳被暫停打斷了，之前等著的重新分頁現在可以做
            if (refitWanted) {
                refitIfNeeded();
            }
        },
        resume() {
            paused = false;
            if (pendingNextPage) {
                nextPageTimer = setTimeout(nextPage, NEXT_PAGE_DELAY_MS);
            }
        },
    };
}

export const matchUp: GameModule<MatchUpOptions> = { ...meta, mount };
export default matchUp;
