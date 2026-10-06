# kancil-games

[Kancil Quiz](https://github.com/foolfitz/kancil-quiz) 內建的計分遊戲：

| 目錄        | 套件                         | 遊戲   |
| ----------- | ---------------------------- | ------ |
| `quiz/`     | `@kancil-quiz/game-quiz`     | 選擇題 |
| `match-up/` | `@kancil-quiz/game-match-up` | 配對   |

不計分的互動教材（字卡、圖卡牆、轉盤）在 [kancil-materials](https://github.com/foolfitz/kancil-materials)；可以單獨執行的迷宮問答在 [maze-quiz](https://github.com/foolfitz/maze-quiz)。

## 只能在 Kancil Quiz 裡面使用

這個 repo 沒有自己的建置與測試設定。遊戲用到平台的 `@kancil-quiz/games-sdk`、`@kancil-quiz/text`，測試還要用 `@kancil-quiz/deck` 與共用的 fixture，所以以 git submodule 掛在 kancil-quiz 的 `packages/games/kancil-games/`，在那裡修改、測試與建置。流程見 kancil-quiz 的 `CLAUDE.md`。

遊戲模組的介面與各遊戲的規則在 kancil-quiz 的 `docs/SPEC.md` 7.2 與 7.5。

## 授權

AGPL-3.0-or-later，與 Kancil Quiz 相同，全文見 `LICENSE`。
