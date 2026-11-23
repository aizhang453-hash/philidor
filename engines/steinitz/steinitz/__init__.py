"""斯坦尼茨 (Steinitz): 下得像真人的国际象棋引擎。"""
import os
import sys

# python-chess、zstandard、torch 装在这里 (见 ~/.local/share/claude-tools/README.txt)
_PKG = os.path.expanduser('~/.local/share/claude-tools/python-packages')
if _PKG not in sys.path:
    sys.path.insert(0, _PKG)
