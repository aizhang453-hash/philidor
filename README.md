# 菲利多尔 (Philidor)

自己做的国际象棋电脑程序, 开源。名字取自 18 世纪法国棋手菲利多尔, 他 1749 年写了《国际象棋分析》。棋盘、棋子和走子的声音用的是 [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant) 的, 功能是自己写的。

现在能做的:

- 人对引擎, 人可以执白也可以执黑
- 引擎对引擎, 能暂停
- 人对人 (同一台电脑上轮流走)
- 悔棋、认输、翻转棋盘

## 怎么用

1. 右边选白方和黑方: 玩家或者某个引擎。引擎那一方还能选每步想多久、棋力 (Stockfish 能按分数调, Komodo 和 Dragon 按等级调)。
2. 点「开始」。走棋: 拖棋子, 或者先点棋子再点要去的格子。
3. 下完或者不想下了, 点「新对局」回到选人。

程序本身不带引擎。第一次打开时, 会把电脑上 En Croissant 装好的引擎拿过来; 也可以点「添加引擎」, 选一个 UCI 引擎程序 (比如从 [Stockfish 官网](https://stockfishchess.org/download/) 下的)。

## 自己编译

要先装 [Node.js](https://nodejs.org/) 和 [Rust](https://rustup.rs/)。

```bash
npm install
```

```bash
npm run tauri dev
```

```bash
npm run tauri build
```

```bash
npm test
```

`npm run tauri dev` 是开发时边改边看; `npm run tauri build` 编出正式的程序 (苹果上在 `src-tauri/target/release/bundle/macos/`)。

在普通浏览器里开发界面: 先 `node tools/dev-bridge.mjs` (替 App 开引擎), 再 `npx vite`, 打开 http://localhost:1420 。

## 许可

程序是 GPL-3.0 (跟 En Croissant 一样)。棋盘、棋子、声音的作者和许可见 [资源出处.md](资源出处.md); 其中棋子 (staunty) 的许可不许商用。
