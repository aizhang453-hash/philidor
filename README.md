# 菲利多尔 (Philidor)

自己做的国际象棋电脑程序, 开源。名字取自 18 世纪法国棋手菲利多尔, 他 1749 年写了《国际象棋分析》。棋盘、棋子和走子的声音用的是 [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant) 的, 功能是自己写的。

现在能做的:

- 人对引擎, 人可以执白也可以执黑
- 引擎对引擎, 能暂停
- 人对人 (同一台电脑上轮流走)
- 限时 (每方几分钟、每步加几秒, 有棋钟) 或不限时
- 引擎的棋力、线程数、内存可以调; 名字旁边有头像和等级分 (照 CCRL 榜)
- 开局库: 引擎开头 10 回合从库里抽 (Lichess 高手的 150 万盘棋统计的), 每盘开局不一样
- 悔棋、认输、翻转棋盘、一键换边
- 对局回顾: 引擎把一盘棋每一步看一遍, 标出好坏、精度、最佳着法 (下完的棋, 或者粘贴进来的棋谱)
- 棋盘设置: 24 套棋子、27 种棋盘、6 套声音, 坐标、记谱用棋子图、棋子动画、高亮上一步、显示能走到哪
- 下载最新的 Stockfish (下了新版换掉旧版); RubiChess 出了新版会提醒

## 怎么用

1. 打开后在开始菜单点「新对局」, 右边选白方和黑方: 玩家或者某个引擎。每一方选限时或不限时; 引擎那一方还能选棋力 (Stockfish 能按分数调, Komodo 和 Dragon 按等级调)、线程数、内存。
2. 点「开始」。走棋: 拖棋子, 或者先点棋子再点要去的格子。
3. 下完或者不想下了, 点「新对局」回到选人; 选人的面板右上角「主菜单」回开始菜单。
4. 下完一盘点「对局回顾」; 别处下的棋在开始菜单点「导入棋谱」, 把棋谱粘贴进去再点「开始」。

程序本身不带引擎。第一次打开时, 会把电脑上 En Croissant 装好的引擎拿过来; 也可以在开始菜单的「引擎」里点「添加引擎」, 选一个 UCI 引擎程序 (比如从 [Stockfish 官网](https://stockfishchess.org/download/) 下的)。在引擎程序所在的文件夹 (或上一层) 放一张 avatar.png (或 .jpg、.webp), 就会当成这个引擎的头像。

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

`npm run tauri dev` 是开发时边改边看; `npm run tauri build` 编出正式的程序 (苹果上在 `src-tauri/target.noindex/release/bundle/macos/`)。

在普通浏览器里开发界面: 先 `node tools/dev-bridge.mjs` (替 App 开引擎), 再 `npx vite`, 打开 http://localhost:1420 。

## 许可

程序是 GPL-3.0 (跟 En Croissant 一样)。棋盘、棋子、声音的作者和许可见 [资源出处.md](资源出处.md); 其中棋子 (staunty) 的许可不许商用。
