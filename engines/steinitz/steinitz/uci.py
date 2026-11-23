"""斯坦尼茨的下棋程序: 说下棋软件通用的「话」(UCI), 能接进菲利多尔这些下棋软件。

开法: 项目文件夹里的 `steinitz-uci` (下棋软件里「添加引擎」选它)。
能调的:
  UCI_LimitStrength / UCI_Elo  下得像多少分的人 (Lichess 的分, 400–2800); 不限棋力时按 2800 下
  UCI_Opponent                 下棋软件告诉它对手多少分 (不说就当跟它一样)
  像真人那样花时间              开着: 想多久照真人来 (有棋钟时按双方还剩多少); 关了: 马上走
  每步最多想几秒                0 = 不限
  随机程度                      100 = 照真人的概率抽; 0 = 总走最可能的那步
  网络文件                      「直觉」网络放在哪
记录: 收到的每一行、每步想了多久, 写在 logs/uci.log (太大了就换一个新的, 旧的改名 uci.log.old)。
"""
import os
import random
import sys
import threading
import time

import chess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NAME = '斯坦尼茨 0.3'
DEFAULT_NET = os.path.join(ROOT, 'nets', 'v1-intuition.pt')
LOG = os.path.join(ROOT, 'logs', 'uci.log')
LOG_MAX = 2_000_000


def _round_base(sec):
    """从看到的最多的钟猜这盘是几分钟的棋: 一分钟以上按半分钟取整。"""
    return sec if sec < 60 else round(sec / 30) * 30


class Engine:
    def __init__(self, out=None, rng=None, log=None):
        self.out = out or sys.stdout
        self.log_path = log
        self.t_start = time.monotonic()
        self.lock = threading.Lock()
        self.rng = rng or random.Random()
        self.opt = {'UCI_LimitStrength': True, 'UCI_Elo': 1500, 'UCI_Opponent': '', '像真人那样花时间': True,
                    '每步最多想几秒': 0, '随机程度': 100, '网络文件': DEFAULT_NET}
        self.player = None
        self.loaded = None
        self.game = None
        self.base_seen = 0.0
        self.worker = None
        self.stop_ev = threading.Event()

    # ---- 说话 ----
    def log(self, text):
        if not self.log_path:
            return
        try:
            os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
            if os.path.exists(self.log_path) and os.path.getsize(self.log_path) > LOG_MAX:
                os.replace(self.log_path, self.log_path + '.old')
            with open(self.log_path, 'a', encoding='utf-8') as f:
                f.write(f'{time.strftime("%m-%d %H:%M:%S")} [{os.getpid()}] {text}\n')
        except OSError:
            pass

    def say(self, line):
        with self.lock:
            self.out.write(line + '\n')
            self.out.flush()

    def options(self):
        o = self.opt
        return [
            'option name UCI_LimitStrength type check default true',
            f'option name UCI_Elo type spin default {o["UCI_Elo"]} min 400 max 2800',
            'option name UCI_Opponent type string default <empty>',
            'option name 像真人那样花时间 type check default true',
            'option name 每步最多想几秒 type spin default 0 min 0 max 600',
            'option name 随机程度 type spin default 100 min 0 max 200',
            f'option name 网络文件 type string default {o["网络文件"]}',
        ]

    def handle(self, line):
        """处理一行; 返回 False 表示要退出。"""
        t = line.strip().split()
        if not t:
            return True
        cmd = t[0]
        if cmd != 'isready':
            self.log('收到 ' + (line.strip() if cmd != 'position' else f'position …{" ".join(t[-3:])} (共 {len(t)} 段)'))
        if cmd == 'uci':
            self.say(f'id name {NAME}')
            self.say('id author aizhang453-hash')
            for s in self.options():
                self.say(s)
            self.say('uciok')
        elif cmd == 'isready':
            if self.worker is None or not self.worker.is_alive():
                self.ensure_net()
            self.say('readyok')
        elif cmd == 'setoption':
            self.setoption(line)
        elif cmd == 'ucinewgame':
            self.halt()
            self.game = None
            self.base_seen = 0.0
        elif cmd == 'position':
            self.halt()
            self.position(t[1:])
        elif cmd == 'go':
            self.halt()
            self.go(t[1:])
        elif cmd in ('stop', 'ponderhit'):
            self.stop_ev.set()
        elif cmd == 'quit':
            self.halt()
            return False
        return True

    def setoption(self, line):
        rest = line.strip()[len('setoption'):].strip()
        if not rest.startswith('name '):
            return
        rest = rest[5:]
        name, _, value = rest.partition(' value ')
        name, value = name.strip(), value.strip()
        if name not in self.opt:
            return
        old = self.opt[name]
        if isinstance(old, bool):
            self.opt[name] = value.lower() == 'true'
        elif isinstance(old, int):
            try:
                self.opt[name] = int(float(value))
            except ValueError:
                pass
        else:
            self.opt[name] = '' if value == '<empty>' else value

    def position(self, t):
        fen, moves = None, []
        if t and t[0] == 'fen':
            i = t.index('moves') if 'moves' in t else len(t)
            fen = ' '.join(t[1:i])
            moves = t[i + 1:]
        elif t and t[0] == 'startpos':
            moves = t[2:] if len(t) > 1 and t[1] == 'moves' else []
        from steinitz.play import Game
        try:
            self.game = Game(fen, moves)
        except ValueError as e:
            self.say(f'info string 局面不对: {e}')
            self.game = None

    # ---- 想 ----
    def ensure_net(self):
        path = self.opt['网络文件']
        if self.player is not None and self.loaded == path:
            return True
        try:
            import torch
            torch.set_num_threads(2)
            from steinitz.play import Player, load
            net, _ = load(path)
            self.player = Player(net)
            self.loaded = path
            return True
        except Exception as e:   # noqa: BLE001  网络文件不对也别让下棋软件卡住
            self.say(f'info string 读不了网络文件 {path}: {e}')
            self.player = None
            return False

    def halt(self):
        if self.worker is not None:
            self.stop_ev.set()
            self.worker.join()
            self.worker = None

    def go(self, t):
        args = {}
        i = 0
        while i < len(t):
            k = t[i]
            if k in ('infinite', 'ponder'):
                args[k] = True
                i += 1
            elif i + 1 < len(t):
                try:
                    args[k] = int(t[i + 1])
                except ValueError:
                    pass
                i += 2
            else:
                i += 1
        self.stop_ev.clear()
        self.worker = threading.Thread(target=self.search, args=(args,), daemon=True)
        self.worker.start()

    def clocks(self, args, white):
        """双方还剩几秒、几分钟的棋、每步加几秒; 没有棋钟返回 None。"""
        me, op = ('wtime', 'btime') if white else ('btime', 'wtime')
        if me not in args:
            return None
        clock = args[me] / 1000
        opp = args.get(op, args[me]) / 1000
        inc = args.get('winc' if white else 'binc', 0) / 1000
        self.base_seen = max(self.base_seen, clock, opp)
        return clock, opp, _round_base(self.base_seen), inc

    def search(self, args):
        try:
            self._search(args)
        except Exception as e:   # noqa: BLE001  出错也要交一步, 不然下棋软件一直等
            self.say(f'info string 出错了: {type(e).__name__}: {e}')
            board = self.game.board if self.game else chess.Board()
            m = next(iter(board.legal_moves), None)
            self.say(f'bestmove {m.uci() if m else "0000"}')

    def _search(self, args):
        t0 = time.monotonic()
        game = self.game
        if game is None:
            from steinitz.play import Game
            game = Game()
        legal = [m.uci() for m in game.board.legal_moves]
        if not legal:
            self.say('bestmove 0000')
            return
        if not self.ensure_net():
            self.say(f'bestmove {legal[0]}')
            return
        o = self.opt
        elo = o['UCI_Elo'] if o['UCI_LimitStrength'] else 2800
        opp = None
        p = o['UCI_Opponent'].split()
        if len(p) >= 2 and p[1].isdigit():
            opp = int(p[1])
        ck = self.clocks(args, game.board.turn == chess.WHITE)
        clock, opp_clock, base, inc = ck if ck else (None, None, None, None)
        analysing = args.get('infinite') or args.get('ponder')
        temp = 0 if analysing else o['随机程度'] / 100
        th = self.player.think(game, elo, opp, clock, opp_clock, base, inc, temp=temp, rng=self.rng)

        wait = th.seconds if o['像真人那样花时间'] else 0.0
        if clock is not None:
            wait = min(wait, max(0.05, clock * 0.4 if clock > 2 else clock * 0.1))
        if 'movetime' in args:
            wait = min(wait, max(0.0, args['movetime'] / 1000 - 0.05))
        if o['每步最多想几秒'] > 0:
            wait = min(wait, o['每步最多想几秒'])
        if analysing:
            wait = None   # 等下棋软件说 stop
        left = None if wait is None else max(0.0, wait - (time.monotonic() - t0))
        self.stop_ev.wait(left)
        ms = int((time.monotonic() - t0) * 1000)
        top = ' '.join(f'{m} {q:.0%}' for m, q in th.top[:3])
        self.say(f'info string 照真人这步想 {th.seconds:.1f} 秒; 走 {th.move} 的人有 {th.prob:.0%}; 最常走的: {top}')
        self.say(f'info depth 1 seldepth 1 multipv 1 score cp {th.cp} nodes 1 time {ms} pv {th.move}')
        self.say(f'bestmove {th.move}')
        self.log(f'第 {game.ply // 2 + 1} 回合 {th.move}: {elo} 分, 钟 {clock} 对 {opp_clock} (几分钟的棋 {base}, 加 {inc}), '
                 f'抽到想 {th.seconds:.1f} 秒, 真的等了 {ms / 1000:.1f} 秒')


def main():
    eng = Engine(log=LOG)
    for line in sys.stdin:
        try:
            if not eng.handle(line):
                break
        except Exception as e:   # noqa: BLE001  一行出错不能让整个程序停掉
            eng.say(f'info string 出错了: {type(e).__name__}: {e}')
    eng.halt()


if __name__ == '__main__':
    sys.path.insert(0, ROOT)
    main()
