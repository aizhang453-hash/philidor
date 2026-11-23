#!/bin/zsh
# 把 engines/steinitz 连同 Python、PyTorch 打成一包 (PyInstaller), 放在 src-tauri/target.noindex/steinitz-dist/steinitz/,
# 编菲利多尔时 (npm run tauri build) 整个文件夹放进程序里 (tauri.conf.json 的 bundle.resources)。
# 要用的东西都在 ~/.local/share/claude-tools/: python-packages (torch、numpy、python-chess) 和 pyinstaller。
set -e
ROOT=${0:A:h:h}
T=$HOME/.local/share/claude-tools
PY=/Library/Frameworks/Python.framework/Versions/3.13/bin/python3
OUT=$ROOT/src-tauri/target.noindex
rm -rf $OUT/steinitz-dist $OUT/steinitz-work
PYTHONPATH=$T/pyinstaller:$T/python-packages $PY -m PyInstaller --noconfirm --clean --log-level WARN \
  --onedir --name steinitz \
  --distpath $OUT/steinitz-dist --workpath $OUT/steinitz-work --specpath $OUT/steinitz-work \
  --paths $ROOT/engines/steinitz --paths $T/python-packages \
  --add-data "$ROOT/engines/steinitz/nets/v1-intuition.pt:nets" \
  --exclude-module tkinter --exclude-module matplotlib --exclude-module IPython --exclude-module zstandard \
  $ROOT/engines/steinitz/main.py
# PyInstaller 把 torch 的大库 (libtorch_cpu 420 MB) 放了两份: 外面一份、torch/lib 里一份。
# torch/lib 里的换成指向外面那份的软链接, 省四百多 MB (软链接要原样放进程序: 用 ditto 拷, 见 tools/build-app.sh)。
I=$OUT/steinitz-dist/steinitz/_internal
for f in $I/torch/lib/*.dylib; do
  n=${f:t}
  if [[ -f $I/$n && ! -L $f ]]; then rm $f; ln -s ../../$n $f; fi
done
echo "打包好了: $OUT/steinitz-dist/steinitz ($(du -sh $OUT/steinitz-dist/steinitz | cut -f1))"
