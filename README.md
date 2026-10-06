# kancil-games

[Kancil Quiz](https://github.com/foolfitz/kancil-quiz) 內建的計分遊戲：

| 目錄              | 套件                               | 遊戲     |
| ----------------- | ---------------------------------- | -------- |
| `maze-quiz/`      | `@kancil-quiz/game-maze-quiz`      | 迷宮問答 |
| `quiz/`           | `@kancil-quiz/game-quiz`           | 選擇題   |
| `match-up/`       | `@kancil-quiz/game-match-up`       | 配對     |
| `whack-a-mole/`   | `@kancil-quiz/game-whack-a-mole`   | 打地鼠   |
| `balloon-archer/` | `@kancil-quiz/game-balloon-archer` | 射氣球   |

`arcade/`（`@kancil-quiz/arcade`）不是遊戲，是打地鼠、射氣球共用的規則：星星、輪次、一批一批出現的目標、倒數。

不計分的互動教材（字卡、圖卡牆、轉盤）在 [kancil-materials](https://github.com/foolfitz/kancil-materials)。

## 只能在 Kancil Quiz 裡面使用

這個 repo 沒有自己的建置與測試設定。遊戲用到平台的 `@kancil-quiz/games-sdk`、`@kancil-quiz/text`，測試還要用 `@kancil-quiz/deck` 與共用的 fixture，所以以 git submodule 掛在 kancil-quiz 的 `packages/games/kancil-games/`，在那裡修改、測試與建置。流程見 kancil-quiz 的 `CLAUDE.md`。

遊戲模組的介面與各遊戲的規則在 kancil-quiz 的 `docs/SPEC.md` 7.2 與 7.5。

## 迷宮問答

在迷宮裡走進正確答案所在的園區，同時躲開敵人。畫面下方（手機橫放時是旁邊一欄）是題目，迷宮邊緣的園區是選項；走進正確答案的園區就過關，一題一關，每一關都是新的迷宮。走錯園區不扣命，但那個園區的門會關上；被敵人碰到會少一條命。操作：鍵盤用方向鍵或 WASD，`Esc` 或 `P` 暫停；滑鼠、觸控按在角色的哪一邊就往哪邊走，按住拖曳可以換方向；觸控方向鍵在暫停畫面中可以放左邊、右邊或不顯示。

- `src/session.ts` 是不碰 DOM 的進行狀態，`src/core/` 是迷宮生成、敵人、玩家與計分，`src/render/` 畫 canvas，`src/input/` 是鍵盤、指標與觸控方向鍵。
- `tests/mount.test.ts` 用 `tests/fakeDom.ts` 的極簡假 DOM 測 `mount()` 與 `destroy()`（不裝 jsdom），確認之後沒有殘留的監聽、計時器與 `requestAnimationFrame`。
- 題目與選項的字型 [Andika](https://software.sil.org/andika/)（SIL International）在 `maze-quiz/fonts/`，原檔使用、未取子集（Andika 是保留字型名稱，刪減字元就不能再叫 Andika），由 `src/style.css` 的 `@font-face` 載入。
- 原本是獨立的 `maze-quiz` repo（MIT，可以單獨執行，有示範頁與平台套件的副本），2026-10 以 `git subtree` 併入這裡，commit 歷史保留。更早之前是獨立的網頁版（標題畫面、排行榜、`quiz.json` 題組），那時的規格與實作決定在 git 歷史中的 `SPEC.md`、`DECISIONS.md`（commit `bf5fa64` 以前）。

## 授權

AGPL-3.0-or-later，與 Kancil Quiz 相同，全文見 `LICENSE`。迷宮問答的字型 Andika 採 SIL Open Font License 1.1，見 `maze-quiz/fonts/OFL.txt`。
