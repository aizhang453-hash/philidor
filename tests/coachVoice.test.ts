import { describe, expect, it } from "vitest";
import { checkTone, cleanTone, toneKind, toneMessages } from "../src/coachVoice";

describe("千问写的口气要过程序检查", () => {
  it("第一次试时千问编的那几句, 全都拦住", () => {
    expect(checkTone("你知道为什么吗？我年轻时也常贪吃小利，却忘了中心才是战场，应学我那句：位置比牺牲重要。", "mistake", [])).not.toBeNull();
    expect(checkTone("你知道为什么吗？错误往往源于忽视小优势，记住正确比漂亮要紧。", "blunder", [])).not.toBeNull();
    expect(checkTone("吃后虽好，但若因贪吃而失先，那便犯了大忌。", "best", [])).not.toBeNull();
    expect(checkTone("我当年在维也纳也选了这步。", "book", [])).toBe("讲往事或引原话");
  });

  it("各种不许的东西", () => {
    expect(checkTone("走 Bxd8 就好。", "best", [])).toBe("有字母或数字 (棋步、年份)");
    expect(checkTone("拉斯克也这样下。", "best", [])).toBe("有人名或地名");
    expect(checkTone("「稳」字当头。", "best", [])).toBe("有引号或书名号");
    expect(checkTone("这次真漂亮。", "blunder", [])).toBe("坏棋夸了");
    expect(checkTone("若贪吃皇后，可曾看清后续代价？", "miss", [])).toBe("说到了棋");
    expect(checkTone("送掉皇后前，可曾看清对手的笑脸？", "blunder", [])).toBe("说到了棋");
    expect(checkTone("稳当当，一点不慌。", "good", ["稳当当，心里有数。"])).toBe("跟前面开头一样");
    expect(checkTone("好。走得稳。", "good", [])).toBe("不止一句");
  });

  it("正常的话能过", () => {
    expect(checkTone("稳稳当当，心里有数。", "best", [])).toBeNull();
    expect(checkTone("别急，静下心来再想。", "blunder", [])).toBeNull();
    expect(checkTone("以后马上就会好的。", "blunder", [])).toBeNull();
    expect(checkTone("不慌不忙，很好。", "best", [])).toBe("照抄了例子");
    expect(checkTone("局面已在你掌控之中。", "best", [])).toBe("说到了棋");
    expect(checkTone("这份从容让人放心你。", "best", [])).toBe("叫了「你」");
    expect(cleanTone("斯坦尼茨：稳着走就好。\n多余的")).toBe("稳着走就好。");
  });

  it("每步说哪种话轮着来, 提示里带着事实", () => {
    expect(toneKind("blunder", 6)).not.toBe(toneKind("blunder", 7));
    const msgs = toneMessages("blunder", "这步把后送掉了。", "comfort");
    expect(msgs[1].content).toContain("这步把后送掉了。");
    expect(msgs[1].content).toContain("安慰");
  });
});
