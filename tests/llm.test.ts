import { beforeEach, describe, expect, it, vi } from "vitest";
import { llmStatus, chat, personaLine, personaMessages, DEFAULT_MODEL } from "../src/llm";

// 假的 Ollama: 记下问了什么, 按 answer 回答 (不碰真的千问)
const asked: { path: string; body: string | null }[] = [];
let answer: (path: string) => { status: number; body: string } = () => ({ status: 200, body: "{}" });
vi.mock("../src/transport", () => ({
  transport: {
    async ollama(path: string, body: string | null) {
      asked.push({ path, body });
      return answer(path);
    },
  },
}));

beforeEach(() => {
  asked.length = 0;
});

describe("大语言模型", () => {
  it("看装了哪些模型", async () => {
    answer = () => ({ status: 200, body: JSON.stringify({ models: [{ name: "qwen3.5:9b" }, { name: "llama3:8b" }] }) });
    expect(await llmStatus()).toEqual({ running: true, models: ["qwen3.5:9b", "llama3:8b"] });
    expect(asked[0]).toEqual({ path: "/api/tags", body: null });
  });

  it("Ollama 没开就当没有", async () => {
    answer = () => {
      throw new Error("连不上 Ollama");
    };
    expect(await llmStatus()).toEqual({ running: false, models: [] });
  });

  it("对话: 关掉想一想, 去掉多余的", async () => {
    answer = () => ({ status: 200, body: JSON.stringify({ message: { role: "assistant", content: "<think>嗯</think>\n 好棋！ " } }) });
    expect(await chat([{ role: "user", content: "你好" }])).toBe("好棋！");
    const sent = JSON.parse(asked[0].body!);
    expect(asked[0].path).toBe("/api/chat");
    expect(sent.model).toBe(DEFAULT_MODEL);
    expect(sent.think).toBe(false);
    expect(sent.stream).toBe(false);
  });

  it("模型出错就抛出 Ollama 的话", async () => {
    answer = () => ({ status: 404, body: JSON.stringify({ error: 'model "x" not found' }) });
    await expect(chat([{ role: "user", content: "你好" }], { model: "x" })).rejects.toThrow('model "x" not found');
  });

  it("角色: 设定和事实都发过去, 用不了返回 null", async () => {
    const persona = { name: "老周", character: "退休的老师傅，说话慢悠悠，爱讲道理。" };
    const msgs = personaMessages(persona, ["你的马在 f6 没人保护，被吃掉了。"]);
    expect(msgs[0].content).toContain("老周");
    expect(msgs[0].content).toContain("不要自己编棋步");
    expect(msgs[1].content).toContain("f6");

    answer = () => ({ status: 200, body: JSON.stringify({ message: { content: "哎，马丢了，下回先看看它有没有人保。" } }) });
    expect(await personaLine(persona, ["你的马在 f6 没人保护，被吃掉了。"])).toBe("哎，马丢了，下回先看看它有没有人保。");

    answer = () => {
      throw new Error("连不上 Ollama");
    };
    expect(await personaLine(persona, ["随便"])).toBeNull();
  });
});
