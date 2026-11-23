"""「直觉」网络的第二种结构: 变换器 (transformer)。v1 用。

跟 v0 的卷积网络 (model.Net) 吃一样的输入、说一样的三样 (走法、赢面、想多久), 训练和考试的程序不用改。
思路照 Maia-3 的论文 (Chessformer, 2026) 自己写的, 没用他们的代码:
- 64 个格子各是一个「词」(token), 每个词带着这个格子在现在和以前 6 个局面里放的是什么子;
- 每一层里每个格子都能「看」所有别的格子 (注意力), 再加一个学出来的「哪个格子跟哪个格子有关」的偏好 (每层每个头一张 64×64 的表);
- 分数、钟这些数: 先变成一个向量 z, 加到每个格子上, 还在每一层调整 (adaLN: 每层的归一化乘一个数、加一个数, 跟 v0 的 FiLM 一个意思);
- 走法: 「从哪个格子」和「到哪个格子」两两配对打分 (64×64), 再换成跟 v0 一样的 4672 种编号; 升变成马象车另加一点分。
"""
import math

import torch
import torch.nn as nn
import torch.nn.functional as F

from . import encoding as E
from .model import N_IN, NT


def _move_table():
    """4672 种走法编号 → 从哪格、到哪格、升变成什么 (-1 = 不是升变成马象车)。走不出棋盘的编号到哪格记 0 (反正不合法)。"""
    frm = torch.zeros(E.NMOVES, dtype=torch.long)
    to = torch.zeros(E.NMOVES, dtype=torch.long)
    promo = torch.full((E.NMOVES,), -1, dtype=torch.long)
    for i in range(E.NMOVES):
        plane, f = divmod(i, 64)
        ff, fr = f % 8, f // 8
        if plane < 56:
            dx, dy = E.DIRS[plane // 7]
            dist = plane % 7 + 1
            df, dr = dx * dist, dy * dist
        elif plane < 64:
            df, dr = E.KNIGHT[plane - 56]
        else:
            up = plane - 64
            df, dr = up % 3 - 1, 1
            promo[i] = up // 3
        tf_, tr = ff + df, fr + dr
        frm[i] = f
        to[i] = tr * 8 + tf_ if 0 <= tf_ < 8 and 0 <= tr < 8 else 0
    return frm, to, promo


class Layer(nn.Module):
    def __init__(self, d, heads, mlp, zc):
        super().__init__()
        self.h = heads
        self.n1 = nn.LayerNorm(d, elementwise_affine=False)
        self.n2 = nn.LayerNorm(d, elementwise_affine=False)
        self.qkv = nn.Linear(d, 3 * d, bias=False)
        self.out = nn.Linear(d, d)
        self.bias = nn.Parameter(torch.zeros(heads, 64, 64))   # 哪个格子跟哪个格子有关 (学出来的)
        self.fc1 = nn.Linear(d, mlp * d)
        self.fc2 = nn.Linear(mlp * d, d)
        self.ada = nn.Linear(zc, 4 * d)                         # 分数、钟调这一层
        nn.init.zeros_(self.ada.weight)
        nn.init.zeros_(self.ada.bias)

    def forward(self, x, z):
        B, T, D = x.shape
        g1, b1, g2, b2 = self.ada(z)[:, None, :].chunk(4, -1)
        y = self.n1(x) * (1 + g1) + b1
        q, k, v = self.qkv(y).view(B, T, 3, self.h, D // self.h).permute(2, 0, 3, 1, 4)
        a = F.scaled_dot_product_attention(q, k, v, attn_mask=self.bias.to(q.dtype))
        x = x + self.out(a.transpose(1, 2).reshape(B, T, D))
        y = self.n2(x) * (1 + g2) + b2
        return x + self.fc2(F.gelu(self.fc1(y)))


class TNet(nn.Module):
    def __init__(self, d=256, layers=8, heads=8, mlp=2, zc=128, arch='tf', ncond=10):
        super().__init__()
        self.cfg = dict(arch='tf', d=d, layers=layers, heads=heads, mlp=mlp, zc=zc, ncond=ncond)
        self.ncond = ncond
        self.zmlp = nn.Sequential(nn.Linear(ncond, zc), nn.GELU(), nn.Linear(zc, zc), nn.GELU())
        self.inp = nn.Linear(N_IN, d)
        self.pos = nn.Parameter(torch.randn(64, d) * 0.02)
        self.zin = nn.Linear(zc, d)
        self.layers = nn.ModuleList([Layer(d, heads, mlp, zc) for _ in range(layers)])
        self.norm = nn.LayerNorm(d)
        # 走法: 从哪格 (q) 跟到哪格 (k) 配对
        self.pq = nn.Linear(d, d)
        self.pk = nn.Linear(d, d)
        self.promo = nn.Linear(d, 3)
        frm, to, promo = _move_table()
        self.register_buffer('ft_index', frm * 64 + to, persistent=False)
        self.register_buffer('promo_from', frm, persistent=False)
        self.register_buffer('promo_kind', promo.clamp(min=0), persistent=False)
        self.register_buffer('promo_on', (promo >= 0).float(), persistent=False)
        self.v1 = nn.Linear(d + zc, 128)
        self.v2 = nn.Linear(128, 3)
        self.t1 = nn.Linear(d + zc, 64)
        self.t2 = nn.Linear(64, NT)

    def forward(self, x, c):
        """x: [B, N_IN, 8, 8] (跟 v0 一样, 用 model.planes 做的); c: [B, N_COND]。"""
        B = x.shape[0]
        z = self.zmlp(c[:, :self.ncond])
        h = self.inp(x.flatten(2).transpose(1, 2)) + self.pos + self.zin(z)[:, None, :]
        for layer in self.layers:
            h = layer(h, z)
        h = self.norm(h)
        d = h.shape[-1]
        ft = torch.matmul(self.pq(h), self.pk(h).transpose(1, 2)) / math.sqrt(d)     # [B, 64 从, 64 到]
        pol = ft.reshape(B, 4096)[:, self.ft_index]
        pr = self.promo(h)                                                            # [B, 64, 3]
        pol = pol + self.promo_on * pr[:, self.promo_from, self.promo_kind]
        pooled = torch.cat([h.mean(1), z], 1)
        v = self.v2(F.gelu(self.v1(pooled)))
        t = self.t2(F.gelu(self.t1(pooled)))
        return pol, v, t
