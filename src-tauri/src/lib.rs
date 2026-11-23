// 开引擎程序、收发它的每一行字。界面那边 (src/transport.ts) 调这里的命令。
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

mod ollama;
mod stockfish;

struct Running {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
struct Engines(Mutex<HashMap<String, Running>>);

#[derive(Clone, Serialize)]
struct LineEvent {
    id: String,
    line: String,
}

#[derive(Serialize)]
struct FoundEngine {
    name: String,
    path: String,
    elo: Option<f64>,
}

#[tauri::command]
fn engine_start(app: AppHandle, engines: State<'_, Engines>, id: String, path: String) -> Result<(), String> {
    let exe = PathBuf::from(&path);
    if !exe.is_file() {
        return Err(format!("找不到这个文件：{path}"));
    }
    let mut cmd = Command::new(&exe);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 不弹命令行窗口
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| format!("开不了：{e}"))?;
    let stdout = child.stdout.take().ok_or("拿不到引擎的输出")?;
    let stdin = child.stdin.take().ok_or("拿不到引擎的输入")?;

    let thread_id = id.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_string();
                    let _ = app.emit("engine-line", LineEvent { id: thread_id.clone(), line });
                }
            }
        }
        let _ = app.emit("engine-exit", thread_id);
    });

    let old = engines.0.lock().unwrap().insert(id, Running { child, stdin });
    if let Some(old) = old {
        shut(old);
    }
    Ok(())
}

#[tauri::command]
fn engine_send(engines: State<'_, Engines>, id: String, line: String) -> Result<(), String> {
    let mut map = engines.0.lock().unwrap();
    let running = map.get_mut(&id).ok_or("引擎没在运行")?;
    writeln!(running.stdin, "{line}")
        .and_then(|_| running.stdin.flush())
        .map_err(|e| format!("发不过去：{e}"))
}

#[tauri::command]
fn engine_stop(engines: State<'_, Engines>, id: String) {
    let running = engines.0.lock().unwrap().remove(&id);
    if let Some(running) = running {
        shut(running);
    }
}

/// 先让引擎自己退出 (quit), 一秒还没退就强行关掉
fn shut(mut running: Running) {
    let _ = writeln!(running.stdin, "quit");
    let _ = running.stdin.flush();
    std::thread::spawn(move || {
        for _ in 0..20 {
            if let Ok(Some(_)) = running.child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = running.child.kill();
        let _ = running.child.wait();
    });
}

/// En Croissant 装好的引擎 (它自己存的清单), 第一次打开时拿过来用
#[tauri::command]
fn encroissant_engines(app: AppHandle) -> Vec<FoundEngine> {
    let Ok(dir) = app.path().data_dir() else {
        return vec![];
    };
    let file = dir.join("org.encroissant.app").join("engines").join("engines.json");
    let Ok(text) = std::fs::read_to_string(file) else {
        return vec![];
    };
    let Ok(list) = serde_json::from_str::<Vec<serde_json::Value>>(&text) else {
        return vec![];
    };
    list.iter()
        .filter_map(|e| {
            if e.get("type")?.as_str()? != "local" {
                return None;
            }
            let path = e.get("path")?.as_str()?.to_string();
            if !Path::new(&path).is_file() {
                return None;
            }
            let name = e.get("name")?.as_str()?.to_string();
            let elo = e.get("elo").and_then(|v| v.as_f64());
            Some(FoundEngine { name, path, elo })
        })
        .collect()
}

#[derive(Serialize)]
struct BuiltinEngine {
    id: String,
    path: String,
    /** 被苹果拦着 (「从网上下载的」标记去不掉) */
    blocked: bool,
}

/// 文件上有没有「从网上下载的」标记 (com.apple.quarantine)
fn quarantined(file: &Path) -> bool {
    Command::new("/usr/bin/xattr")
        .arg("-p")
        .arg("com.apple.quarantine")
        .arg(file)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 从网上下载的菲利多尔, 苹果给里面每个文件都打上「从网上下载的」标记; 带着这个标记,
/// 自带的斯坦尼茨 (没有苹果开发者签名) 一启动就被系统关掉。用户已经同意打开菲利多尔了,
/// 这里把斯坦尼茨文件夹上的标记去掉。去不掉 (程序没拖进「应用程序」, 苹果让它在只读的地方跑) 返回 false。
fn clear_quarantine(dir: &Path, exe: &Path) -> bool {
    if !quarantined(exe) {
        return true;
    }
    let _ = Command::new("/usr/bin/xattr")
        .arg("-dr")
        .arg("com.apple.quarantine")
        .arg(dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    !quarantined(exe)
}

/// 菲利多尔自带的引擎: 编程序时放进程序里的斯坦尼茨 (tools/steinitz-build.sh 打的包, 在 Resources/steinitz/)
#[tauri::command]
fn builtin_engines(app: AppHandle) -> Vec<BuiltinEngine> {
    let Ok(dir) = app.path().resource_dir() else {
        return vec![];
    };
    let folder = dir.join("steinitz");
    let exe = folder.join("steinitz");
    if !exe.is_file() {
        return vec![];
    }
    let blocked = !clear_quarantine(&folder, &exe);
    vec![BuiltinEngine { id: "builtin-steinitz".into(), path: exe.to_string_lossy().into_owned(), blocked }]
}

/// 菲利多尔自己放引擎的文件夹 (苹果上是 ~/Library/Application Support/io.github.aizhang453-hash.philidor/engines)
fn engines_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("engines"))
        .map_err(|e| format!("找不到程序的文件夹：{e}"))
}

fn engine_list_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("engines.json"))
        .map_err(|e| format!("找不到程序的文件夹：{e}"))
}

/// 引擎清单 (engines.json), 还没有就是 None
#[tauri::command]
fn engines_load(app: AppHandle) -> Option<String> {
    std::fs::read_to_string(engine_list_file(&app).ok()?).ok()
}

#[tauri::command]
fn engines_save(app: AppHandle, json: String) -> Result<(), String> {
    let file = engine_list_file(&app)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("建不了文件夹：{e}"))?;
    }
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("存不了：{e}"))?;
    std::fs::rename(&tmp, &file).map_err(|e| format!("存不了：{e}"))
}

#[tauri::command]
async fn stockfish_latest() -> Result<stockfish::Latest, String> {
    tauri::async_runtime::spawn_blocking(stockfish::latest)
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
struct Progress {
    done: u64,
    total: u64,
}

/// 下载最新的 Stockfish, 下载时发 stockfish-progress 事件
#[tauri::command]
async fn stockfish_download(app: AppHandle) -> Result<stockfish::Downloaded, String> {
    let dir = engines_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let latest = stockfish::latest()?;
        stockfish::download(&latest, &dir, |done, total| {
            let _ = app.emit("stockfish-progress", Progress { done, total });
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 引擎文件夹里放的头像: avatar.png / .jpg / .jpeg / .webp, 先找引擎程序所在的文件夹, 再找上一层。
/// 返回能直接放进 <img> 的 data: 网址; 没有就是 None。
fn find_avatar(exe: &Path) -> Option<String> {
    use base64::Engine as _;
    let dir = exe.parent()?;
    for d in [Some(dir), dir.parent()].into_iter().flatten() {
        for (name, mime) in [
            ("avatar.png", "image/png"),
            ("avatar.jpg", "image/jpeg"),
            ("avatar.jpeg", "image/jpeg"),
            ("avatar.webp", "image/webp"),
        ] {
            let file = d.join(name);
            let Ok(meta) = std::fs::metadata(&file) else { continue };
            if !meta.is_file() || meta.len() > 2_000_000 {
                continue;
            }
            let bytes = std::fs::read(&file).ok()?;
            return Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)));
        }
    }
    None
}

#[tauri::command]
fn engine_avatar(path: String) -> Option<String> {
    find_avatar(Path::new(&path))
}

/// 问本机的大语言模型 (Ollama)。只连本机, 只许几个接口 (见 ollama.rs)
#[tauri::command]
async fn ollama_request(path: String, body: Option<String>, timeout_ms: u64) -> Result<ollama::Reply, String> {
    tauri::async_runtime::spawn_blocking(move || ollama::request(&path, body.as_deref(), timeout_ms))
        .await
        .map_err(|e| e.to_string())?
}

/// 开始菜单的「退出」
#[tauri::command]
fn app_quit(app: AppHandle) {
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Engines::default())
        .invoke_handler(tauri::generate_handler![
            engine_start,
            engine_send,
            engine_stop,
            encroissant_engines,
            builtin_engines,
            engines_load,
            engines_save,
            stockfish_latest,
            stockfish_download,
            ollama_request,
            engine_avatar,
            app_quit
        ])
        .build(tauri::generate_context!())
        .expect("程序启动失败")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                // 关程序时把引擎都关掉
                let engines = app.state::<Engines>();
                let all: Vec<Running> = engines.0.lock().unwrap().drain().map(|(_, r)| r).collect();
                for mut r in all {
                    let _ = r.child.kill();
                    let _ = r.child.wait();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_avatar_next_to_engine_or_one_up() {
        let root = std::env::temp_dir().join(format!("philidor-avatar-{}", std::process::id()));
        let osx = root.join("OSX");
        std::fs::create_dir_all(&osx).unwrap();
        let exe = osx.join("engine");
        std::fs::write(&exe, b"").unwrap();
        assert_eq!(find_avatar(&exe), None);
        std::fs::write(root.join("avatar.jpg"), [0xff, 0xd8, 0xff]).unwrap();
        assert_eq!(find_avatar(&exe).as_deref(), Some("data:image/jpeg;base64,/9j/"));
        std::fs::write(osx.join("avatar.png"), [0x89, b'P', b'N']).unwrap();
        assert_eq!(find_avatar(&exe).as_deref(), Some("data:image/png;base64,iVBO"));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
