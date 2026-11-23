"""「直觉」网络: 看棋盘 + 双方的分和钟, 一次说出三样 ——
每步被走的概率 (policy)、谁赢面大 (value: 输 / 和 / 赢)、这步大概想多久 (time: 分几档)。

结构: 残差卷积网络 (像 Leela / Maia), 分数和钟这些数先过一个小网络变成 z,
z 在每一层里调整网络 (FiLM: 每个通道乘一个数、加一个数), 这样同一个局面, 分不一样想法就不一样。
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

from . import encoding as E

N_IN = E.NBOARDS * 12 + 4 + 1 + 1 + 1   # 棋子 7×12 + 易位 4 + 过路兵 1 + 五十步 1 + 全 1
N_COND = 12        # 前 10 个是 v0 就有的; 后 2 个 (v1 起): 真人这步想了多久、给没给 (老网络只用前 10 个)
TIME_EDGES = [1, 2, 3, 5, 8, 13, 21, 34, 55]   # 想几秒分 10 档: <1, 1–2, 2–3, 3–5 … 55 秒以上
NT = len(TIME_EDGES) + 1


def planes(boards, extra):
    """boards [B,7,32] uint8、extra [B,4] uint8 (都在显卡上) → 输入 [B, N_IN, 8, 8]。"""
    B = boards.shape[0]
    codes = torch.stack([boards & 15, boards >> 4], -1).reshape(B, E.NBOARDS, 64).long()
    pieces = F.one_hot(codes, 13)[..., 1:].permute(0, 1, 3, 2).reshape(B, E.NBOARDS * 12, 8, 8).float()
    ex = extra.long()
    castle = torch.stack([(ex[:, 1] >> i) & 1 for i in range(4)], 1).float()[:, :, None, None].expand(B, 4, 8, 8)
    ep = torch.zeros(B, 64, device=boards.device)
    has = ex[:, 2] > 0
    ep[has, 5 * 8 + ex[has, 2] - 1] = 1.0          # 能吃过路兵的那个格子 (翻过以后在第 6 行)
    r50 = (ex[:, 3].float() / 100)[:, None, None, None].expand(B, 1, 8, 8)
    ones = torch.ones(B, 1, 8, 8, device=boards.device)
    return torch.cat([pieces, castle, ep.reshape(B, 1, 8, 8), r50, ones], 1)


def cond(elo, clock, tc, ply, extra, spent=None, known=None):
    """分、钟这些数 → [B, N_COND]。

    spent / known (v1 起): 真人这步想了几秒、这一个给不给网络看 (known 是 0 或 1)。
    不给 (考试时、下棋时还没定) 两个都是 0; 下棋时先抽「想多久」, 再把抽到的时间给它, 按「想了这么久」选步。
    """
    e = (elo.float() - 1500) / 500
    diff = (elo[:, 0] - elo[:, 1]).float() / 400
    cl = torch.log1p(clock.float().clamp(min=0)) / 7
    base = tc[:, 0].float()
    frac = (clock[:, 0].float() / base.clamp(min=1)).clamp(max=2)
    if spent is None or known is None:
        sp = kn = torch.zeros_like(base)
    else:
        kn = known.float()
        sp = torch.log1p(spent.float().clamp(min=0)) / 4 * kn
    return torch.stack([
        e[:, 0], e[:, 1], diff, cl[:, 0], cl[:, 1],
        torch.log1p(base) / 8, tc[:, 1].float() / 30, frac,
        ply.float() / 100, extra[:, 0].float() / E.HIST, sp, kn,
    ], 1)


class Block(nn.Module):
    def __init__(self, ch, zc):
        super().__init__()
        self.c1 = nn.Conv2d(ch, ch, 3, padding=1, bias=False)
        self.n1 = nn.BatchNorm2d(ch)
        self.c2 = nn.Conv2d(ch, ch, 3, padding=1, bias=False)
        self.n2 = nn.BatchNorm2d(ch)
        self.film = nn.Linear(zc, 2 * ch)
        nn.init.zeros_(self.film.weight)
        nn.init.zeros_(self.film.bias)
        self.se1 = nn.Linear(ch, ch // 4)
        self.se2 = nn.Linear(ch // 4, 2 * ch)

    def forward(self, x, z):
        y = F.relu(self.n1(self.c1(x)))
        y = self.n2(self.c2(y))
        g, b = self.film(z).chunk(2, 1)
        y = y * (1 + g[:, :, None, None]) + b[:, :, None, None]
        w, bb = self.se2(F.relu(self.se1(y.mean((2, 3))))).chunk(2, 1)
        y = y * torch.sigmoid(w)[:, :, None, None] + bb[:, :, None, None]
        return F.relu(x + y)


class Net(nn.Module):
    def __init__(self, blocks=8, ch=128, zc=64, ncond=10):
        super().__init__()
        self.cfg = dict(blocks=blocks, ch=ch, zc=zc, ncond=ncond)
        self.ncond = ncond   # 10 = 像 v0 那样不看「想了多久」; 12 = 看
        self.zmlp = nn.Sequential(nn.Linear(ncond, zc), nn.ReLU(), nn.Linear(zc, zc), nn.ReLU())
        self.inp = nn.Conv2d(N_IN, ch, 3, padding=1, bias=False)
        self.inn = nn.BatchNorm2d(ch)
        self.blocks = nn.ModuleList([Block(ch, zc) for _ in range(blocks)])
        self.p1 = nn.Conv2d(ch, ch, 3, padding=1)
        self.p2 = nn.Conv2d(ch, 73, 1)
        self.v1 = nn.Conv2d(ch, 32, 1)
        self.v2 = nn.Linear(32 * 64 + zc, 128)
        self.v3 = nn.Linear(128, 3)
        self.t1 = nn.Conv2d(ch, 16, 1)
        self.t2 = nn.Linear(16 * 64 + zc, 64)
        self.t3 = nn.Linear(64, NT)

    def forward(self, x, c):
        z = self.zmlp(c[:, :self.ncond])
        h = F.relu(self.inn(self.inp(x)))
        for b in self.blocks:
            h = b(h, z)
        pol = self.p2(F.relu(self.p1(h))).reshape(h.shape[0], E.NMOVES)
        v = self.v3(F.relu(self.v2(torch.cat([F.relu(self.v1(h)).flatten(1), z], 1))))
        t = self.t3(F.relu(self.t2(torch.cat([F.relu(self.t1(h)).flatten(1), z], 1))))
        return pol, v, t


def count_params(net):
    return sum(p.numel() for p in net.parameters())


def build(cfg):
    """按存下来的 cfg 造网络: 没写 arch 的是 v0 的卷积网络, arch='tf' 是变换器。"""
    cfg = dict(cfg)
    arch = cfg.pop('arch', 'conv')
    if arch == 'tf':
        from .model_tf import TNet
        return TNet(**cfg)
    return Net(**cfg)
