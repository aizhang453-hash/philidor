// 开引擎程序、收发它的每一行字。界面那边 (src/transport.ts) 调这里的命令。
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

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
            Some(FoundEngine { name, path })
        })
        .collect()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Engines::default())
        .invoke_handler(tauri::generate_handler![engine_start, engine_send, engine_stop, encroissant_engines])
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
