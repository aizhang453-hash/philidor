"""把棋盘和走法变成网络能读的数字。

都按「轮到走的那一方」来看: 轮到黑方时把棋盘上下翻过来、黑白对调,
这样网络看到的永远是「我在下面、往上走」, 白方黑方学的是同一套。

棋盘: 64 个格子, 每格一个数 —— 0 空; 1–6 我方 兵马象车后王; 7–12 对方 兵马象车后王。
      两个格子挤一个字节 (前一格放低 4 位), 一个棋盘 32 字节。
走法: 跟 AlphaZero 一样分 73 种 × 64 个起点 = 4672 个:
      0–55  往 8 个方向走 1–7 格 (方向 × 7 + 格数 − 1)
      56–63 马的 8 种跳法
      64–72 升变成马、象、车 (× 往左吃、直走、往右吃); 升变成后算普通的直走 / 斜吃
      编号 = 种类 × 64 + 起点格 (翻过以后的)
"""
import numpy as np
import chess

HIST = 6                 # 往前带几个局面
NBOARDS = HIST + 1       # 现在的 + 以前的
NMOVES = 73 * 64

DIRS = [(0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1)]
KNIGHT = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
_DIR_INDEX = {d: i for i, d in enumerate(DIRS)}
_KNIGHT_INDEX = {d: i for i, d in enumerate(KNIGHT)}


def _sign(x):
    return (x > 0) - (x < 0)


def move_index(move, us):
    """一步棋的编号 (us = 轮到走的一方)。"""
    f, t = move.from_square, move.to_square
    if us == chess.BLACK:
        f ^= 56
        t ^= 56
    df = (t & 7) - (f & 7)
    dr = (t >> 3) - (f >> 3)
    if move.promotion and move.promotion != chess.QUEEN:
        plane = 64 + (move.promotion - chess.KNIGHT) * 3 + (df + 1)
    elif (df, dr) in _KNIGHT_INDEX:
        plane = 56 + _KNIGHT_INDEX[(df, dr)]
    else:
        dist = max(abs(df), abs(dr))
        plane = _DIR_INDEX[(_sign(df), _sign(dr))] * 7 + dist - 1
    return plane * 64 + f


def board_codes(board, us):
    """64 个格子的数 (按 us 的方向看)。"""
    a = np.zeros(64, dtype=np.uint8)
    flip = 56 if us == chess.BLACK else 0
    for sq, p in board.piece_map().items():
        a[sq ^ flip] = p.piece_type + (0 if p.color == us else 6)
    return a


def pack(codes):
    return (codes[0::2] | (codes[1::2] << 4)).astype(np.uint8)


def unpack(packed):
    """numpy 版的反过来 (网络里用 torch 版, 见 model.py)。"""
    out = np.empty(packed.shape[:-1] + (64,), dtype=np.uint8)
    out[..., 0::2] = packed & 15
    out[..., 1::2] = packed >> 4
    return out


def castle_bits(board, us):
    them = not us
    return (int(board.has_kingside_castling_rights(us))
            | int(board.has_queenside_castling_rights(us)) << 1
            | int(board.has_kingside_castling_rights(them)) << 2
            | int(board.has_queenside_castling_rights(them)) << 3)


def ep_file(board):
    """能吃过路兵时: 那一列 + 1; 不能: 0。"""
    if board.ep_square is not None and board.has_legal_en_passant():
        return (board.ep_square & 7) + 1
    return 0


def encode_position(hist_fen, hist_moves):
    """从「几步以前的局面 + 这几步」得到: 棋盘们 (NBOARDS × 32 字节)、以前有几个局面、
    易位、过路兵、五十步计数、所有合法走法的编号, 还有现在的棋盘 (给调用的人用)。"""
    board = chess.Board(hist_fen)
    boards = [board.copy(stack=False)]
    for u in hist_moves:
        board.push_uci(u)
        boards.append(board.copy(stack=False))
    us = board.turn
    out = np.zeros((NBOARDS, 32), dtype=np.uint8)
    # 现在的放第 0 个, 往前一步放第 1 个……
    for i, b in enumerate(reversed(boards[-NBOARDS:])):
        out[i] = pack(board_codes(b, us))
    legal = [move_index(m, us) for m in board.legal_moves]
    return out, len(boards) - 1, castle_bits(board, us), ep_file(board), min(board.halfmove_clock, 255), legal, board
