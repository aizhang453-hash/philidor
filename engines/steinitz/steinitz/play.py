"""像真人那样下一步 (设计第三步「能下了」)。

做法 (docs/设计.md「想的时间也像真人」):
  1. 先问「直觉」网络: 这个分的人在这里大概想多久 (10 档), 照它抽一档, 再在这一档里抽一个秒数;
  2. 把抽到的秒数告诉网络, 问「想了这么久的这个分的人会走哪步」, 照概率抽一步 (不总走最可能的那步);
  3. 下棋程序 (steinitz/uci.py) 等够这么多秒再走。
现在只靠直觉, 不往后算 (全力模式是第四步)。
"""
import math
import random
from dataclasses import dataclass, field

import chess
import numpy as np
import torch
import torch.nn.functional as F

from . import encoding as E
from . import model as M

ELO_MIN, ELO_MAX = 400, 2800    # 练的资料里的分数段 (Lichess 的分)
FREE_BASE, FREE_INC = 900, 10   # 没有棋钟 (像「每步想 1 秒」) 时, 当成 15 分钟、每步加 10 秒的棋
# 每一档的秒数范围 (跟 model.TIME_EDGES 一样: <1, 1–2, 2–3 … 55 秒以上)
_LO = [0.0] + M.TIME_EDGES
_HI = M.TIME_EDGES + [None]


def load(path, device='cpu'):
    ck = torch.load(path, map_location='cpu', weights_only=False)
    net = M.build(ck['cfg'])
    net.load_state_dict({k.replace('_orig_mod.', ''): v for k, v in ck['model'].items()})
    net.eval()
    return net.to(device), ck


class Game:
    """一盘棋走到现在: 从哪个局面开始 (默认开局) + 走了哪些步 (UCI 写法)。"""

    def __init__(self, fen=None, moves=()):
        start = chess.Board(fen) if fen else chess.Board()
        self.ply0 = (start.fullmove_number - 1) * 2 + (0 if start.turn == chess.WHITE else 1)
        self.moves = []
        self.fens = [start.fen()]
        self.board = start
        for u in moves:
            self.push(u)

    def push(self, uci):
        m = chess.Move.from_uci(uci)
        if m not in self.board.legal_moves:
            raise ValueError(f'不合规矩的一步: {uci}')
        self.board.push(m)
        self.moves.append(uci)
        self.fens.append(self.board.fen())

    @property
    def ply(self):
        """第几个半步 (0 = 白方第一步), 跟练的资料一样。"""
        return self.ply0 + len(self.moves)

    def history(self):
        """网络要看的: 几步以前的局面 + 从那以后的几步 (最多 E.HIST 步)。"""
        n = len(self.moves)
        k = min(E.HIST, n)
        return self.fens[n - k], self.moves[n - k:]


@dataclass
class Thought:
    move: str            # 走哪步 (UCI 写法)
    prob: float          # 这步在「想了这么久的人」里有多少会走
    seconds: float       # 抽到想几秒
    band: int            # 抽到的那一档 (0–9)
    wdl: tuple           # 轮到走的一方: 赢、和、输各多少
    top: list = field(default_factory=list)   # 最常走的几步 [(走法, 概率)]

    @property
    def cp(self):
        """赢面换成「百分之几个兵」给下棋软件显示 (跟 Lc0 的换法一样)。"""
        q = max(-0.99, min(0.99, self.wdl[0] - self.wdl[2]))
        return int(round(90 * math.tan(1.5637541897 * q)))


TAIL = 25.0   # 想 55 秒以上的那一档, 再多想的秒数平均多少 (Lichess 真人: 平均 80 秒左右, 中位 70, 九成在 120 以下)


def sample_seconds(band, rng):
    """在一档里抽一个秒数: 按对数均匀抽 (1–2 秒那档里 1.2 秒和 1.8 秒差不多常见); 最后一档 55 秒以上照真人拖个尾巴。"""
    lo, hi = _LO[band], _HI[band]
    if hi is None:
        return lo + rng.expovariate(1 / TAIL)
    if lo == 0:
        return rng.uniform(0.2, hi)
    return lo * math.exp(rng.uniform(0, math.log(hi / lo)))


class Player:
    def __init__(self, net, device='cpu'):
        self.net = net
        self.dev = torch.device(device)
        self.sees_time = net.cfg.get('ncond', 10) > 10

    @torch.no_grad()
    def _run(self, x, c):
        pol, v, t = self.net(x, c)
        return pol[0], F.softmax(v[0], 0), t[0]

    @torch.no_grad()
    def think(self, game, elo, opp_elo=None, clock=None, opp_clock=None, base=None, inc=None,
              temp=1.0, rng=None):
        """elo: 它自己的分 (Lichess 分); opp_elo: 对手的分 (不知道就当一样); clock / opp_clock: 双方还剩几秒;
        base / inc: 几分钟的棋 (秒)、每步加几秒。没给钟就当成 15 分钟 + 10 秒的棋、还没开始用时间。
        temp: 随机程度, 1 = 照真人的概率抽, 0 = 总走最可能的那步。"""
        rng = rng or random.Random()
        elo = int(min(ELO_MAX, max(ELO_MIN, elo)))
        opp = elo if opp_elo is None else int(min(elo + 400, max(elo - 400, opp_elo)))
        if clock is None:
            clock, opp_clock, base, inc = FREE_BASE, FREE_BASE, FREE_BASE, FREE_INC
        opp_clock = clock if opp_clock is None else opp_clock
        base = max(clock, opp_clock) if base is None else base
        inc = 0 if inc is None else inc

        hist_fen, hist = game.history()
        boards, hl, castle, ep, r50, legal, now = E.encode_position(hist_fen, hist)
        moves = list(now.legal_moves)   # 跟 legal 的次序一样
        if not moves:
            raise ValueError('没有能走的步 (棋已经下完了)')
        T = torch.tensor
        extra = T(np.array([[hl, castle, ep, r50]], np.uint8))
        x = M.planes(T(boards[None]), extra).to(self.dev)
        args = (T([[elo, opp]]), T([[float(clock), float(opp_clock)]]), T([[int(base), int(inc)]]),
                T([game.ply]), extra)
        pol, wdl, tl = self._run(x, M.cond(*args).to(self.dev))

        # 先抽想多久
        pt = F.softmax(tl.float(), 0).cpu().numpy()
        band = rng.choices(range(len(pt)), weights=pt.tolist())[0]
        sec = sample_seconds(band, rng)
        if self.sees_time:   # 再问「想了这么久的人」走哪步
            c = M.cond(*args, spent=T([sec]), known=T([1.0])).to(self.dev)
            pol, _, _ = self._run(x, c)

        logits = pol.float().cpu()[T(legal)]
        p = F.softmax(logits, 0)
        if temp <= 0:
            i = int(p.argmax())
        else:
            q = F.softmax(logits / temp, 0).numpy()
            i = rng.choices(range(len(q)), weights=q.tolist())[0]
        order = p.argsort(descending=True)[:5].tolist()
        win, draw, lose = wdl[2].item(), wdl[1].item(), wdl[0].item()
        return Thought(moves[i].uci(), p[i].item(), sec, band, (win, draw, lose),
                       [(moves[j].uci(), p[j].item()) for j in order])
