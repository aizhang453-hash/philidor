#!/bin/zsh
# 把斯坦尼茨下棋要用的文件从斯坦尼茨项目复制进菲利多尔 (engines/steinitz/), 以后自带进程序。
# 斯坦尼茨改了下棋的规矩或者换了网络以后跑一次, 再跑 tools/steinitz-build.sh 打包。
# 用法: tools/steinitz-sync.sh [斯坦尼茨项目文件夹, 默认 ~/game/steinitz]
set -e
SRC=${1:-$HOME/game/steinitz}
DST=${0:A:h:h}/engines/steinitz
mkdir -p $DST/steinitz $DST/nets
for f in __init__.py encoding.py model.py model_tf.py play.py uci.py; do
  cp $SRC/steinitz/$f $DST/steinitz/$f
done
cp $SRC/nets/v1-intuition.pt $DST/nets/v1-intuition.pt
COMMIT=$(git -C $SRC log -1 --format='%h %ad' --date=short)
if [[ -n $(git -C $SRC status --porcelain -- steinitz nets) ]]; then EXTRA=" (加上当时还没提交的改动)"; else EXTRA=""; fi
{
  echo "# 斯坦尼茨 (自带)"
  echo
  echo "菲利多尔自带的国际象棋引擎「斯坦尼茨」: 下得像真人, 选一个分就像那个分的人那样下。"
  echo "这里是从斯坦尼茨项目复制来的下棋部分 (tools/steinitz-sync.sh), 编程序前用 tools/steinitz-build.sh 连同 Python、PyTorch 打成一包。"
  echo
  echo "复制自斯坦尼茨项目提交 $COMMIT$EXTRA, $(date '+%Y-%m-%d')。"
  echo
  echo "| 文件 | sha256 |"
  echo "| --- | --- |"
  (cd $DST && for f in steinitz/*.py nets/*.pt; do echo "| $f | $(shasum -a 256 $f | cut -c1-16) |"; done)
} > $DST/说明.md
echo "复制好了: $DST"
