//! 问本机的大语言模型 (Ollama, 像通义千问)。只连本机的 127.0.0.1:11434, 只许问下面这几个接口。
use std::time::Duration;

use serde::Serialize;

const BASE: &str = "http://127.0.0.1:11434";
/// 版本、装了哪些模型、对话
const ALLOWED: &[&str] = &["/api/version", "/api/tags", "/api/chat"];

/// HTTP 状态和正文 (正文是 Ollama 给的 JSON, 网页那边自己看)
#[derive(Serialize)]
pub struct Reply {
    pub status: u16,
    pub body: String,
}

pub fn request(path: &str, body: Option<&str>, timeout_ms: u64) -> Result<Reply, String> {
    if !ALLOWED.contains(&path) {
        return Err(format!("不许问 {path}"));
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_millis(timeout_ms.clamp(500, 600_000))))
        .http_status_as_error(false)
        .build()
        .into();
    let url = format!("{BASE}{path}");
    let result = match body {
        Some(b) => agent.post(&url).header("Content-Type", "application/json").send(b),
        None => agent.get(&url).call(),
    };
    let mut resp = result.map_err(|e| format!("连不上 Ollama：{e}"))?;
    let status = resp.status().as_u16();
    let body = resp.body_mut().read_to_string().map_err(|e| format!("读不了回答：{e}"))?;
    Ok(Reply { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真的问一次本机的千问 (要开着 Ollama): cargo test -- --ignored real_chat --nocapture
    #[test]
    #[ignore]
    fn real_chat() {
        let body = r#"{"model":"qwen3.5:9b","stream":false,"think":false,"keep_alive":"5m","options":{"num_predict":30},"messages":[{"role":"user","content":"用一句中文说：别着急。"}]}"#;
        let r = request("/api/chat", Some(body), 60_000).expect("连不上 Ollama");
        assert_eq!(r.status, 200, "{}", r.body);
        println!("千问说: {}", r.body.chars().take(300).collect::<String>());
    }

    #[test]
    fn refuses_other_paths() {
        assert!(request("/api/delete", Some("{}"), 1000).is_err());
        assert!(request("/api/pull", Some("{}"), 1000).is_err());
        assert!(request("http://example.com/api/chat", None, 1000).is_err());
    }
}
