// 跟本机的大语言模型说话 (Ollama 里的通义千问这类)。还没接到界面上, 以后角色说话用。
// 分工: 走哪步、这步好不好由引擎算; 程序把算出来的事实交给模型, 模型只按角色的性格把事实说成一两句话。
// 没装 Ollama、没开、没有这个模型、超时, personaLine 都返回 null, 角色改说写好的句子。
import { transport } from "./transport";

/** 用户电脑上装的千问 */
export const DEFAULT_MODEL = "qwen3.5:9b";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmStatus {
  /** Ollama 开着 */
  running: boolean;
  /** 装了哪些模型, 像 qwen3.5:9b */
  models: string[];
}

/** Ollama 开没开、装了哪些模型 (不会把模型读进内存) */
export async function llmStatus(): Promise<LlmStatus> {
  try {
    const r = await transport.ollama("/api/tags", null, 2000);
    if (r.status !== 200) return { running: false, models: [] };
    const data = JSON.parse(r.body) as { models?: { name: string }[] };
    return { running: true, models: (data.models ?? []).map((m) => m.name) };
  } catch {
    return { running: false, models: [] };
  }
}

export interface ChatOptions {
  model?: string;
  /** 越高说法越多变, 0 到 1.5 */
  temperature?: number;
  /** 最多说多少个词元 (token, 中文差不多一个字一个) */
  maxTokens?: number;
  timeoutMs?: number;
  /** 说完以后模型在内存里留多久, 像 "5m"; "0" 是马上放掉 */
  keepAlive?: string;
}

/** 发给 Ollama 的内容 */
export function chatRequest(messages: ChatMessage[], opts: ChatOptions = {}) {
  return {
    model: opts.model ?? DEFAULT_MODEL,
    messages,
    stream: false,
    // 千问会先「想一想」再说, 想的过程又长又慢, 关掉
    think: false,
    keep_alive: opts.keepAlive ?? "5m",
    options: {
      temperature: opts.temperature ?? 0.8,
      num_predict: opts.maxTokens ?? 200,
    },
  };
}

/** 从 Ollama 的回答里取出说的话 */
export function replyText(body: string): string {
  const data = JSON.parse(body) as { error?: string; message?: { content?: string } };
  if (data.error) throw new Error(data.error);
  const text = String(data.message?.content ?? "");
  // 万一还是带着想的过程, 去掉
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** 发一段对话, 拿回模型说的话; 出错就抛出来 */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const r = await transport.ollama("/api/chat", JSON.stringify(chatRequest(messages, opts)), opts.timeoutMs ?? 60_000);
  if (r.status !== 200) {
    let msg = `Ollama 出错 (HTTP ${r.status})`;
    try {
      msg = (JSON.parse(r.body) as { error?: string }).error ?? msg;
    } catch {
      /* 正文不是 JSON */
    }
    throw new Error(msg);
  }
  return replyText(r.body);
}

/** 一个角色: 名字, 还有性格和说话的样子 */
export interface Persona {
  name: string;
  character: string;
}

export function personaMessages(persona: Persona, facts: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        `你是${persona.name}，正在下国际象棋。${persona.character}\n` +
        "只根据给你的事实说话，不要自己编棋步、局面或分数。用口语说一两句，不超过四十个字，只说中文。",
    },
    { role: "user", content: facts.join("\n") },
  ];
}

/** 角色按事实说一句; 模型用不了就返回 null (改说写好的句子) */
export async function personaLine(persona: Persona, facts: string[], opts: ChatOptions = {}): Promise<string | null> {
  try {
    const text = await chat(personaMessages(persona, facts), { temperature: 0.9, maxTokens: 120, timeoutMs: 20_000, ...opts });
    return text || null;
  } catch {
    return null;
  }
}
