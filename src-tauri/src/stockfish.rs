// 从 Stockfish 官方的 GitHub 发布页下载最新版, 核对指纹, 解压到菲利多尔自己的引擎文件夹。
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const API: &str = "https://api.github.com/repos/official-stockfish/Stockfish/releases/latest";
const UA: &str = "philidor";

#[derive(Deserialize, Clone)]
pub struct Asset {
    pub name: String,
    pub size: u64,
    pub browser_download_url: String,
    pub digest: Option<String>,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
}

/// 最新版的信息
#[derive(Serialize, Clone)]
pub struct Latest {
    /// 像 sf_19
    pub tag: String,
    /// 像 19
    pub version: String,
    pub asset: String,
    pub size: u64,
    #[serde(skip)]
    url: String,
    #[serde(skip)]
    digest: Option<String>,
}

/// 下载好的
#[derive(Serialize)]
pub struct Downloaded {
    pub tag: String,
    pub version: String,
    pub path: String,
}

pub fn latest() -> Result<Latest, String> {
    let mut resp = ureq::get(API)
        .header("User-Agent", UA)
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("连不上 GitHub：{e}"))?;
    let rel: Release = resp.body_mut().read_json().map_err(|e| format!("看不懂发布页：{e}"))?;
    let asset = pick_asset(&rel.assets, std::env::consts::OS, std::env::consts::ARCH)
        .ok_or("发布页上没有这种电脑用的 Stockfish")?
        .clone();
    Ok(Latest {
        version: rel.tag_name.trim_start_matches("sf_").to_string(),
        tag: rel.tag_name,
        asset: asset.name,
        size: asset.size,
        url: asset.browser_download_url,
        digest: asset.digest,
    })
}

/// 按系统和处理器挑一个包。sf_19 起每个系统一个 universal 包 (里面按处理器自己挑最快的)。
pub fn pick_asset<'a>(assets: &'a [Asset], os: &str, arch: &str) -> Option<&'a Asset> {
    let os_key = match os {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        _ => return None,
    };
    let arch_key = match arch {
        "x86_64" => "x86-64",
        "aarch64" => "arm64",
        _ => "",
    };
    let other_arch = |name: &str| {
        ["x86-64", "arm64", "armv7", "riscv64", "apple-silicon", "m1"]
            .iter()
            .any(|k| *k != arch_key && name.contains(k) && !(arch == "aarch64" && (*k == "apple-silicon" || *k == "m1")))
    };
    assets
        .iter()
        .filter(|a| {
            let n = a.name.as_str();
            n.starts_with("stockfish-")
                && n.contains(os_key)
                && (n.ends_with(".tar.gz") || n.ends_with(".tar") || n.ends_with(".zip"))
                && !other_arch(n)
        })
        .max_by_key(|a| {
            let n = a.name.as_str();
            let mut score = 0;
            if n.contains("universal") {
                score += 4;
            }
            if !arch_key.is_empty() && n.contains(arch_key) {
                score += 2;
            }
            // 老的发布页苹果芯片的包叫 m1-apple-silicon
            if arch == "aarch64" && (n.contains("apple-silicon") || n.contains("m1")) {
                score += 2;
            }
            score
        })
}

/// 下载、核对、解压。progress(已下载, 一共) 大概每 1% 调一次。成功后删掉以前下载的旧版。
pub fn download(latest: &Latest, engines_dir: &Path, mut progress: impl FnMut(u64, u64)) -> Result<Downloaded, String> {
    fs::create_dir_all(engines_dir).map_err(|e| format!("建不了文件夹：{e}"))?;
    let archive = engines_dir.join(format!(".{}", latest.asset));
    let resp = ureq::get(&latest.url)
        .header("User-Agent", UA)
        .call()
        .map_err(|e| format!("下载不了：{e}"))?;
    let total = resp.body().content_length().unwrap_or(latest.size);
    let mut reader = resp.into_body().into_reader();
    let mut file = fs::File::create(&archive).map_err(|e| format!("存不了：{e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut done: u64 = 0;
    let mut last_report = 0u64;
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("下载断了：{e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| format!("存不了：{e}"))?;
        hasher.update(&buf[..n]);
        done += n as u64;
        if total > 0 && done - last_report >= total / 100 {
            last_report = done;
            progress(done, total);
        }
    }
    file.flush().map_err(|e| format!("存不了：{e}"))?;
    drop(file);
    progress(done, total);

    let result = (|| {
        if let Some(expected) = latest.digest.as_deref().and_then(|d| d.strip_prefix("sha256:")) {
            let got: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
            if !got.eq_ignore_ascii_case(expected) {
                return Err("下载的文件跟官方的指纹对不上".to_string());
            }
        }
        let dest = engines_dir.join(format!("stockfish-{}", latest.tag));
        if dest.exists() {
            fs::remove_dir_all(&dest).map_err(|e| format!("删不了旧文件夹：{e}"))?;
        }
        fs::create_dir_all(&dest).map_err(|e| format!("建不了文件夹：{e}"))?;
        unpack(&archive, &dest)?;
        let exe = find_exe(&dest, &latest.asset).ok_or("包里找不到 Stockfish 程序")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).map_err(|e| format!("设不了权限：{e}"))?;
        }
        remove_old(engines_dir, &dest);
        Ok(Downloaded {
            tag: latest.tag.clone(),
            version: latest.version.clone(),
            path: exe.to_string_lossy().into_owned(),
        })
    })();
    let _ = fs::remove_file(&archive);
    result
}

fn unpack(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| format!("打不开下载的文件：{e}"))?;
    let name = archive.to_string_lossy();
    if name.ends_with(".zip") {
        let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("解压不了：{e}"))?;
        zip.extract(dest).map_err(|e| format!("解压不了：{e}"))
    } else if name.ends_with(".tar.gz") {
        tar::Archive::new(flate2::read::GzDecoder::new(file))
            .unpack(dest)
            .map_err(|e| format!("解压不了：{e}"))
    } else {
        tar::Archive::new(file).unpack(dest).map_err(|e| format!("解压不了：{e}"))
    }
}

/// 包里跟包同名的那个程序 (stockfish-macos-universal); 找不到就挑最大的 stockfish 开头的文件
fn find_exe(dir: &Path, asset: &str) -> Option<PathBuf> {
    let stem = asset.trim_end_matches(".tar.gz").trim_end_matches(".tar").trim_end_matches(".zip");
    let mut files = Vec::new();
    collect(dir, &mut files);
    let is_program = |p: &Path| {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.starts_with("stockfish") {
            return false;
        }
        if cfg!(windows) {
            name.ends_with(".exe")
        } else {
            !name.contains('.')
        }
    };
    let wanted = if cfg!(windows) { format!("{stem}.exe") } else { stem.to_string() };
    files
        .iter()
        .find(|p| p.file_name().and_then(|n| n.to_str()) == Some(wanted.as_str()))
        .cloned()
        .or_else(|| {
            files
                .iter()
                .filter(|p| is_program(p))
                .max_by_key(|p| p.metadata().map(|m| m.len()).unwrap_or(0))
                .cloned()
        })
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect(&p, out);
        } else {
            out.push(p);
        }
    }
}

/// 删掉以前下载的 stockfish-sf_* 文件夹 (只删菲利多尔自己下的)
fn remove_old(engines_dir: &Path, keep: &Path) {
    let Ok(entries) = fs::read_dir(engines_dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if p != keep && p.is_dir() && name.starts_with("stockfish-sf_") {
            let _ = fs::remove_dir_all(p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> Asset {
        Asset { name: name.into(), size: 1, browser_download_url: String::new(), digest: None }
    }

    #[test]
    fn picks_sf19_packages() {
        let names = [
            "stockfish-android-arm64-universal.tar.gz",
            "stockfish-android-armv7-neon.tar.gz",
            "stockfish-linux-arm64-universal.tar.gz",
            "stockfish-linux-riscv64-universal.tar.gz",
            "stockfish-linux-x86-64-universal.tar.gz",
            "stockfish-macos-universal.tar.gz",
            "stockfish-windows-arm64-universal.zip",
            "stockfish-windows-x86-64-universal.zip",
        ];
        let assets: Vec<Asset> = names.iter().map(|n| asset(n)).collect();
        let pick = |os, arch| pick_asset(&assets, os, arch).map(|a| a.name.clone());
        assert_eq!(pick("macos", "aarch64").as_deref(), Some("stockfish-macos-universal.tar.gz"));
        assert_eq!(pick("macos", "x86_64").as_deref(), Some("stockfish-macos-universal.tar.gz"));
        assert_eq!(pick("windows", "x86_64").as_deref(), Some("stockfish-windows-x86-64-universal.zip"));
        assert_eq!(pick("windows", "aarch64").as_deref(), Some("stockfish-windows-arm64-universal.zip"));
        assert_eq!(pick("linux", "x86_64").as_deref(), Some("stockfish-linux-x86-64-universal.tar.gz"));
        assert_eq!(pick("linux", "aarch64").as_deref(), Some("stockfish-linux-arm64-universal.tar.gz"));
    }

    #[test]
    fn picks_older_style_packages() {
        let names = [
            "stockfish-macos-m1-apple-silicon.tar",
            "stockfish-macos-x86-64-avx2.tar",
            "stockfish-macos-x86-64.tar",
            "stockfish-windows-x86-64-avx2.zip",
        ];
        let assets: Vec<Asset> = names.iter().map(|n| asset(n)).collect();
        assert_eq!(pick_asset(&assets, "macos", "aarch64").unwrap().name, "stockfish-macos-m1-apple-silicon.tar");
        assert!(pick_asset(&assets, "macos", "x86_64").unwrap().name.contains("x86-64"));
    }

    /// 真的去下载一次 (要联网, 80 MB): cargo test -- --ignored download_real
    /// 设了 PHILIDOR_TEST_DIR 就下载到那里, 不然下载到临时文件夹
    #[test]
    #[ignore]
    fn download_real() {
        let dir = std::env::var("PHILIDOR_TEST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join("philidor-sf-test"));
        let latest = latest().expect("查最新版");
        println!("最新版 {} {} {} 字节", latest.tag, latest.asset, latest.size);
        let mut calls = 0;
        let got = download(&latest, &dir, |_, _| calls += 1).expect("下载");
        println!("下载到 {}, 进度报了 {calls} 次", got.path);
        assert!(calls > 10);
        let out = std::process::Command::new(&got.path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut c| {
                c.stdin.take().unwrap().write_all(b"uci\nquit\n")?;
                c.wait_with_output()
            })
            .expect("运行");
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains("uciok"), "{text}");
        assert!(text.contains(&format!("id name Stockfish {}", latest.version)), "{text}");
    }
}
