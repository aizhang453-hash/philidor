import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { COACHES, coachOf } from "../src/coaches";

describe("教练", () => {
  it("每位教练的头像都在; 不认得的换成第一位", () => {
    for (const c of COACHES) expect(existsSync(`public${c.avatar}`), c.id).toBe(true);
    expect(coachOf("steinitz").name).toBe("斯坦尼茨");
    expect(coachOf("没有这位").id).toBe(COACHES[0].id);
    expect(coachOf(null).id).toBe(COACHES[0].id);
  });
});
