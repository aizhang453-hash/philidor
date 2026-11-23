#!/bin/zsh
# 编正式的菲利多尔 (带着自带的斯坦尼茨):
#   1. 还没打过斯坦尼茨的包就先打 (tools/steinitz-build.sh)
#   2. npm run tauri build
#   3. 用 ditto 把斯坦尼茨放进 菲利多尔.app/Contents/Resources/steinitz (ditto 会原样保留软链接;
#      Tauri 自己放资源会把软链接当成文件再拷一份, 又多四百多 MB)
#   4. 重新签名 (ad-hoc), 再检查签名
set -e
ROOT=${0:A:h:h}
export PATH=$HOME/.cargo/bin:$HOME/.local/node/bin:$PATH
# 编出来的程序里会留下编译时的文件路径 (出错信息用), 里面有这台电脑的用户名; 换成 ~
export RUSTFLAGS="--remap-path-prefix=$HOME=~"
cd $ROOT
DIST=src-tauri/target.noindex/steinitz-dist/steinitz
[[ -x $DIST/steinitz ]] || tools/steinitz-build.sh
npm run tauri build
APP="src-tauri/target.noindex/release/bundle/macos/菲利多尔.app"
rm -rf "$APP/Contents/Resources/steinitz"
ditto $DIST "$APP/Contents/Resources/steinitz"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo "编好了: $APP ($(du -sh "$APP" | cut -f1))"
