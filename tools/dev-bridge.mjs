// 开发、测试用: 在普通浏览器里打开界面时, 由这个小程序替 App 开引擎。
// 用法: node tools/dev-bridge.mjs [别的引擎路径…]
// 只听本机 127.0.0.1:17890, 只认 http://localhost:1420 来的请求, 只开 En Croissant 清单里的引擎和命令行给的引擎。
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const PORT = 17890;
const ORIGIN = "http://localhost:1420";

function encroissantEngines() {
  const file = join(homedir(), "Library/Application Support/org.encroissant.app/engines/engines.json");
  try {
    return JSON.parse(readFileSync(file, "utf8"))
      .filter((e) => e.type === "local" && existsSync(e.path))
      .map((e) => ({ name: e.name, path: e.path }));
  } catch {
    return [];
  }
}

const allowed = new Set([...encroissantEngines().map((e) => e.path), ...process.argv.slice(2)]);
const engines = new Map();
const clients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

function start(id, path) {
  if (!allowed.has(path)) throw new Error(`不在允许的清单里：${path}`);
  const child = spawn(path, [], { cwd: dirname(path), stdio: ["pipe", "pipe", "ignore"] });
  let rest = "";
  child.stdout.on("data", (chunk) => {
    rest += chunk.toString("utf8");
    const lines = rest.split("\n");
    rest = lines.pop();
    for (const line of lines) broadcast("line", { id, line: line.replace(/\r$/, "") });
  });
  child.on("exit", () => {
    engines.delete(id);
    broadcast("exit", { id });
  });
  child.on("error", () => {});
  engines.set(id, child);
}

function stop(id) {
  const child = engines.get(id);
  if (!child) return;
  engines.delete(id);
  try {
    child.stdin.write("quit\n");
  } catch {}
  setTimeout(() => child.kill(), 1000);
}

// 查官方发布页上最新的 Stockfish (跟 App 里一样是真的查)
async function stockfishLatest() {
  const r = await fetch("https://api.github.com/repos/official-stockfish/Stockfish/releases/latest", {
    headers: { "User-Agent": "philidor", Accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error(`连不上 GitHub：${r.status}`);
  const d = await r.json();
  const a = d.assets.find((x) => x.name.includes("macos")) ?? d.assets[0];
  return { tag: d.tag_name, version: d.tag_name.replace(/^sf_/, ""), asset: a?.name ?? "", size: a?.size ?? 0 };
}

// 开发时不真的下载 (真的下载在 Rust 里, 有 cargo 测试): 假装下载一秒, 交回命令行给的、已经下载好的 Stockfish
async function fakeDownload() {
  const path = [...allowed].find((p) => /stockfish-sf_[^/]+\//.test(p));
  if (!path) throw new Error("dev-bridge：命令行没给一个放在 stockfish-sf_xx 文件夹里的 Stockfish");
  for (let i = 1; i <= 10; i++) {
    broadcast("progress", { done: i * 8_000_000, total: 80_000_000 });
    await new Promise((r) => setTimeout(r, 100));
  }
  const tag = path.match(/stockfish-(sf_[^/]+)\//)[1];
  return { tag, version: tag.replace(/^sf_/, ""), path };
}

const server = createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": ORIGIN };
  if (req.headers.origin && req.headers.origin !== ORIGIN) {
    res.writeHead(403, cors).end();
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "content-type" }).end();
    return;
  }
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(": hi\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (req.method === "POST" && req.url === "/cmd") {
    if (req.headers.origin !== ORIGIN) {
      res.writeHead(403, cors).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const send = (code, data) => {
        res.writeHead(code, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      try {
        const cmd = JSON.parse(body);
        if (cmd.op === "start") start(cmd.id, cmd.path);
        else if (cmd.op === "send") {
          const child = engines.get(cmd.id);
          if (!child) throw new Error("引擎没在运行");
          child.stdin.write(cmd.line + "\n");
        } else if (cmd.op === "stop") stop(cmd.id);
        else if (cmd.op === "find") return send(200, { engines: encroissantEngines() });
        else if (cmd.op === "stockfish-latest") return send(200, { latest: await stockfishLatest() });
        else if (cmd.op === "stockfish-download") return send(200, { downloaded: await fakeDownload() });
        send(200, { ok: true });
      } catch (e) {
        send(400, { error: e.message });
      }
    });
    return;
  }
  res.writeHead(404, cors).end();
});

server.listen(PORT, "127.0.0.1", () => console.log(`dev-bridge 在 http://127.0.0.1:${PORT}`));

const quitAll = () => {
  for (const child of engines.values()) child.kill();
  process.exit(0);
};
process.on("SIGINT", quitAll);
process.on("SIGTERM", quitAll);
