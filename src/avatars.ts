// 名字旁边的头像。先看引擎文件夹里有没有放 avatar.png 之类的图 (像 Komodo、Dragon, 图只在自己电脑上);
// 再看认不认得 (Stockfish 用它自己的); 别的引擎和玩家用自己画的 (tools/avatar.mjs)。
import { transport } from "./transport";

export const PLAYER_AVATAR = "/avatars/player.svg";
export const ENGINE_AVATAR = "/avatars/engine.svg";

/** 引擎名字 → 它自己的头像 */
const KNOWN: [RegExp, string][] = [[/^stockfish\b/i, "/avatars/stockfish.png"]];

/** own 是引擎文件夹里找到的头像 */
export function engineAvatar(name: string, own?: string | null): string {
  if (own) return own;
  for (const [re, src] of KNOWN) if (re.test(name.trim())) return src;
  return ENGINE_AVATAR;
}

/** 每个引擎 (按程序路径) 文件夹里放的头像 */
export async function loadOwnAvatars(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    paths.map(async (p) => {
      const a = await transport.engineAvatar(p).catch(() => null);
      if (a) out[p] = a;
    }),
  );
  return out;
}
