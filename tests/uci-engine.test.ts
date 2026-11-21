import { describe, expect, it, vi } from "vitest";

// 假的引擎: 记下发给它的每一行, 收到 uci 就报选项
const sent: string[] = [];
vi.mock("../src/transport", () => {
  let reply: (line: string) => void = () => {};
  return {
    transport: {
      async start(_id: string, _path: string, onLine: (l: string) => void) {
        reply = onLine;
      },
      async send(_id: string, line: string) {
        sent.push(line);
        if (line === "uci") {
          for (const l of [
            "id name Fakefish 1",
            "option name Threads type spin default 1 min 1 max 4",
            "option name Hash type spin default 16 min 1 max 512",
            "option name Ponder type check default true",
            "uciok",
          ])
            setTimeout(() => reply(l), 0);
        }
        if (line === "isready") setTimeout(() => reply("readyok"), 0);
      },
      async stop() {},
    },
  };
});

const { UciEngine } = await import("../src/uci");

describe("引擎设置", () => {
  it("线程数和内存发给引擎, 超出范围取边上的值", async () => {
    const e = await UciEngine.open("/fake");
    expect(e.name).toBe("Fakefish 1");
    sent.length = 0;
    e.configure(null, 8, 1024);
    expect(sent).toEqual([
      "setoption name Ponder value false",
      "setoption name Threads value 4",
      "setoption name Hash value 512",
    ]);
    sent.length = 0;
    e.configure(null, 2, 128);
    expect(sent).toContain("setoption name Threads value 2");
    expect(sent).toContain("setoption name Hash value 128");
    e.quit();
  });
});
