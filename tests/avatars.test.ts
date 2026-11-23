import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { ENGINE_AVATAR, PLAYER_AVATAR, engineAvatar } from "../src/avatars";

describe("头像", () => {
  it("Stockfish 用自己的, 别的用画的", () => {
    expect(engineAvatar("Stockfish 19")).toBe("/avatars/stockfish.png");
    expect(engineAvatar("stockfish dev-20261101")).toBe("/avatars/stockfish.png");
    expect(engineAvatar("Komodo 14.1")).toBe(ENGINE_AVATAR);
    expect(engineAvatar("Dragon by Komodo Chess")).toBe(ENGINE_AVATAR);
    expect(engineAvatar("斯坦尼茨 0.3")).toBe("/avatars/steinitz-engine.png");
  });

  it("图片文件都在", () => {
    for (const src of [PLAYER_AVATAR, ENGINE_AVATAR, engineAvatar("Stockfish 19")]) {
      expect(existsSync(`public${src}`), src).toBe(true);
    }
  });
});

describe("引擎文件夹里的头像", () => {
  it("放了图就用放的", () => {
    expect(engineAvatar("Komodo 14.1", "data:image/jpeg;base64,AAAA")).toBe("data:image/jpeg;base64,AAAA");
    expect(engineAvatar("Stockfish 19", null)).toBe("/avatars/stockfish.png");
  });
});

import { isBuiltin } from "../src/engines";
describe("自带的引擎", () => {
  it("编号以 builtin- 开头的是自带的, 不能删", () => {
    const base = { name: "斯坦尼茨 0.3", path: "/x", strength: null };
    expect(isBuiltin({ ...base, id: "builtin-steinitz" })).toBe(true);
    expect(isBuiltin({ ...base, id: "steinitz-qtod8" })).toBe(false);
  });
});
