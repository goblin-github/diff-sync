use std::collections::HashMap;
use std::fs::{create_dir_all, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;
use tracing;

use crate::error::AppError;
use crate::ssh_session;
use crate::ssh_session::EnvCredential;

const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;
const CRED_CACHE_TTL_SECS: u64 = 5;

// ── Credential persistence ──

/// In-memory cache to avoid redundant disk I/O on consecutive operations.
static CRED_CACHE: Mutex<Option<(Instant, HashMap<String, EnvCredential>)>> = Mutex::new(None);

fn get_credential_store_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let mut path = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::CredentialStore(e.to_string()))?;
    create_dir_all(&path).map_err(|e| AppError::CredentialStore(e.to_string()))?;
    path.push("credentials.json");
    Ok(path)
}

fn load_credentials(app: &AppHandle) -> HashMap<String, EnvCredential> {
    // Check cache first
    if let Ok(cache) = CRED_CACHE.lock() {
        if let Some((timestamp, cached)) = cache.as_ref() {
            if timestamp.elapsed().as_secs() < CRED_CACHE_TTL_SECS {
                return cached.clone();
            }
        }
    }
    // Read from disk
    let map = if let Ok(path) = get_credential_store_path(app) {
        if path.exists() {
            if let Ok(mut file) = File::open(&path) {
                let mut data = String::new();
                if file.read_to_string(&mut data).is_ok() {
                    serde_json::from_str::<HashMap<String, EnvCredential>>(&data).unwrap_or_default()
                } else {
                    HashMap::new()
                }
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        }
    } else {
        HashMap::new()
    };
    // Update cache
    if let Ok(mut cache) = CRED_CACHE.lock() {
        *cache = Some((Instant::now(), map.clone()));
    }
    map
}

fn save_credentials_map(
    app: &AppHandle,
    map: HashMap<String, EnvCredential>,
) -> Result<(), AppError> {
    let path = get_credential_store_path(app)?;

    let mut open_opts = OpenOptions::new();
    open_opts.create(true).write(true).truncate(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        open_opts.mode(0o600);
    }

    let mut file = open_opts.open(&path)?;

    let data =
        serde_json::to_string_pretty(&map).map_err(|e| AppError::CredentialStore(e.to_string()))?;
    file.write_all(data.as_bytes())?;
    // Invalidate cache after write
    if let Ok(mut cache) = CRED_CACHE.lock() {
        *cache = Some((Instant::now(), map));
    }
    Ok(())
}

#[tauri::command]
pub async fn save_env_credential(
    app: AppHandle,
    env_id: String,
    password: Option<String>,
    private_key_passphrase: Option<String>,
) -> Result<(), AppError> {
    let mut map = load_credentials(&app);
    map.insert(
        env_id,
        EnvCredential {
            password,
            private_key_passphrase,
        },
    );
    save_credentials_map(&app, map)
}

#[tauri::command]
pub async fn delete_env_credential(app: AppHandle, env_id: String) -> Result<(), AppError> {
    let mut map = load_credentials(&app);
    map.remove(&env_id);
    save_credentials_map(&app, map)
}

#[tauri::command]
pub async fn clear_all_credentials(app: AppHandle) -> Result<(), AppError> {
    save_credentials_map(&app, HashMap::new())
}

#[tauri::command]
pub async fn get_env_credential(
    app: AppHandle,
    env_id: String,
) -> Result<EnvCredential, AppError> {
    let map = load_credentials(&app);
    Ok(map.get(&env_id).cloned().unwrap_or_default())
}

// ── SSH Commands ──

#[tauri::command]
pub async fn test_ssh_connection(
    app: AppHandle,
    host: String,
    port: u16,
    username: String,
    private_key_path: Option<String>,
    password: Option<String>,
    private_key_passphrase: Option<String>,
) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || {
        let cred = EnvCredential {
            password,
            private_key_passphrase,
        };
        let mut on_hostkey = |_fingerprint: &str| -> Result<(), AppError> {
            Ok(())
        };
        let sess = ssh_session::establish_ssh_session(
            &app, &host, port, &username,
            private_key_path.as_deref(), cred, 6,
            &mut on_hostkey,
        )?;
        let cache_key = ssh_session::make_cache_key(&host, port, &username, private_key_path.as_deref());
        ssh_session::release_session(&app, &cache_key, sess);
        Ok("连接成功".to_string())
    })
    .await
    .map_err(|e| AppError::SshConnection(e.to_string()))?
}

#[tauri::command]
pub async fn read_remote_config(
    app: AppHandle,
    env_id: String,
    host: String,
    port: u16,
    username: String,
    private_key_path: Option<String>,
    remote_file_path: String,
) -> Result<(String, String), AppError> {
    tokio::task::spawn_blocking(move || {
        let map = load_credentials(&app);
        let cred = map.get(&env_id).cloned().unwrap_or_default();
        let mut on_hostkey = |_fingerprint: &str| -> Result<(), AppError> { Ok(()) };
        let cache_key = ssh_session::make_cache_key(&host, port, &username, private_key_path.as_deref());
        let mut sess = ssh_session::establish_ssh_session(
            &app, &host, port, &username,
            private_key_path.as_deref(), cred, 8,
            &mut on_hostkey,
        )?;

        // Open SFTP channel with one automatic retry if the cached session
        // had become stale (race between keepalive probe and sftp()).
        let sftp = match sess.sftp() {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(%cache_key, "SFTP open failed: {}, retrying with fresh session", e);
                ssh_session::evict_session(&app, &cache_key);
                let cred2 = map.get(&env_id).cloned().unwrap_or_default();
                sess = ssh_session::establish_ssh_session(
                    &app, &host, port, &username,
                    private_key_path.as_deref(), cred2, 8,
                    &mut on_hostkey,
                )?;
                sess.sftp()
                    .map_err(|e2| AppError::Sftp(format!("SFTP会话开启失败(已重试): {}", e2)))?
            }
        };

        let result = (|| -> Result<(String, String), AppError> {
            let path = Path::new(&remote_file_path);
            let stat = match sftp.stat(path) {
                Ok(s) => s,
                Err(e) => {
                    match e.code() {
                        ssh2::ErrorCode::SFTP(2) => {
                            return Err(AppError::FileNotFound);
                        }
                        _ => {
                            return Err(AppError::Sftp(format!("读取远程属性异常: {}", e)));
                        }
                    }
                }
            };
            if let Some(size) = stat.size {
                if size > MAX_FILE_SIZE {
                    return Err(AppError::FileTooLarge(size));
                }
            }
            let mut file = sftp
                .open(path)
                .map_err(|e| AppError::Sftp(format!("打开远程文件流失败: {}", e)))?;
            let mut contents = String::new();
            file.read_to_string(&mut contents)
                .map_err(|e| AppError::Sftp(format!("数据读取流中断: {}", e)))?;
            let ending = if contents.contains("\r\n") {
                "CRLF"
            } else {
                "LF"
            };
            Ok((contents, ending.to_string()))
        })();
        drop(sftp);
        ssh_session::release_session(&app, &cache_key, sess);
        result
    })
    .await
    .map_err(|e| AppError::SshConnection(e.to_string()))?
}

#[tauri::command]
pub async fn write_remote_config(
    app: AppHandle,
    env_id: String,
    host: String,
    port: u16,
    username: String,
    private_key_path: Option<String>,
    remote_file_path: String,
    content: String,
    original_ending: String,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let map = load_credentials(&app);
        let cred = map.get(&env_id).cloned().unwrap_or_default();
        let mut on_hostkey = |_fingerprint: &str| -> Result<(), AppError> { Ok(()) };
        let cache_key = ssh_session::make_cache_key(&host, port, &username, private_key_path.as_deref());
        let mut sess = ssh_session::establish_ssh_session(
            &app, &host, port, &username,
            private_key_path.as_deref(), cred, 10,
            &mut on_hostkey,
        )?;

        // Open SFTP channel with one automatic retry.
        let sftp = match sess.sftp() {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(%cache_key, "SFTP open failed: {}, retrying with fresh session", e);
                ssh_session::evict_session(&app, &cache_key);
                let cred2 = map.get(&env_id).cloned().unwrap_or_default();
                sess = ssh_session::establish_ssh_session(
                    &app, &host, port, &username,
                    private_key_path.as_deref(), cred2, 10,
                    &mut on_hostkey,
                )?;
                sess.sftp()
                    .map_err(|e2| AppError::Sftp(format!("SFTP写入开启失败(已重试): {}", e2)))?
            }
        };

        let result = (|| -> Result<(), AppError> {
            let path = Path::new(&remote_file_path);
            ssh_session::ensure_remote_dir_exists(&sftp, path)?;

            let processed_content = if original_ending == "CRLF" {
                content.replace('\n', "\r\n")
            } else {
                content.replace("\r\n", "\n")
            };

            let mut file = sftp
                .create(path)
                .map_err(|e| AppError::Sftp(format!("创建目标文件失败: {}", e)))?;
            file.write_all(processed_content.as_bytes())
                .map_err(|e| AppError::Sftp(format!("写入目标文件失败: {}", e)))?;
            Ok(())
        })();
        drop(sftp);
        ssh_session::release_session(&app, &cache_key, sess);
        result
    })
    .await
    .map_err(|e| AppError::SshConnection(e.to_string()))?
}

/// Combined push: backup (if enabled) + write in a single SSH session.
#[tauri::command]
pub async fn push_remote_config(
    app: AppHandle,
    env_id: String,
    host: String,
    port: u16,
    username: String,
    private_key_path: Option<String>,
    remote_file_path: String,
    content: String,
    original_ending: String,
    backup_enabled: bool,
) -> Result<Option<BackupRecord>, AppError> {
    tokio::task::spawn_blocking(move || {
        let map = load_credentials(&app);
        let cred = map.get(&env_id).cloned().unwrap_or_default();
        let mut on_hostkey = |_fingerprint: &str| -> Result<(), AppError> { Ok(()) };
        let cache_key = ssh_session::make_cache_key(&host, port, &username, private_key_path.as_deref());
        let mut sess = ssh_session::establish_ssh_session(
            &app, &host, port, &username,
            private_key_path.as_deref(), cred, 10,
            &mut on_hostkey,
        )?;

        // Open SFTP channel with one automatic retry.
        let sftp = match sess.sftp() {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(%cache_key, "SFTP open failed: {}, retrying with fresh session", e);
                ssh_session::evict_session(&app, &cache_key);
                let cred2 = map.get(&env_id).cloned().unwrap_or_default();
                sess = ssh_session::establish_ssh_session(
                    &app, &host, port, &username,
                    private_key_path.as_deref(), cred2, 10,
                    &mut on_hostkey,
                )?;
                sess.sftp()
                    .map_err(|e2| AppError::Sftp(format!("SFTP会话开启失败(已重试): {}", e2)))?
            }
        };

        let result = (|| -> Result<Option<BackupRecord>, AppError> {
            let path = Path::new(&remote_file_path);

            // Phase 1: Backup (same SSH session)
            let backup_record: Option<BackupRecord> = if backup_enabled {
                match sftp.open(path) {
                    Ok(mut file) => {
                        let mut contents = Vec::new();
                        file.read_to_end(&mut contents)
                            .map_err(|e| AppError::Sftp(format!("备份读取数据流中断: {}", e)))?;

                        let backup_dir = get_backup_dir(&app, &env_id)?;
                        cleanup_old_backups(&backup_dir, 5)?;

                        let base = path
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("config");
                        let ts = chrono::Local::now().format("%Y%m%d_%H%M%S%.3f").to_string();
                        let backup_name = format!("{}.{}.bak", base, ts);
                        let backup_path = backup_dir.join(&backup_name);

                        let mut out = OpenOptions::new()
                            .create(true)
                            .write(true)
                            .truncate(true)
                            .open(&backup_path)
                            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, format!("创建备份文件失败: {}", e))))?;
                        out.write_all(&contents)
                            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, format!("写入备份文件失败: {}", e))))?;

                        Some(BackupRecord {
                            filename: backup_name,
                            timestamp: ts,
                            size: contents.len() as u64,
                        })
                    }
                    Err(e) => {
                        if e.code() == ssh2::ErrorCode::SFTP(2) {
                            None
                        } else {
                            return Err(AppError::Sftp(format!("备份读取远程文件失败: {}", e)));
                        }
                    }
                }
            } else {
                None
            };

            // Phase 2: Write (same SSH session)
            ssh_session::ensure_remote_dir_exists(&sftp, path)?;
            let processed_content = if original_ending == "CRLF" {
                content.replace('\n', "\r\n")
            } else {
                content.replace("\r\n", "\n")
            };
            let mut file = sftp
                .create(path)
                .map_err(|e| AppError::Sftp(format!("创建目标文件失败: {}", e)))?;
            file.write_all(processed_content.as_bytes())
                .map_err(|e| AppError::Sftp(format!("写入目标文件失败: {}", e)))?;
            Ok(backup_record)
        })();
        drop(sftp);
        ssh_session::release_session(&app, &cache_key, sess);
        result
    })
    .await
    .map_err(|e| AppError::SshConnection(e.to_string()))?
}

// ── Validation ──

#[tauri::command]
pub fn validate_config_format(content: String, file_path: String) -> Result<(), AppError> {
    let path = Path::new(&file_path);
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "json" => {
            let _ = serde_json::from_str::<serde_json::Value>(&content)
                .map_err(|e| AppError::Validation(format!("JSON格式错误: {}", e)))?;
        }
        "toml" => {
            let _ = toml::from_str::<toml::Value>(&content)
                .map_err(|e| AppError::Validation(format!("TOML格式错误: {}", e)))?;
        }
        "yaml" | "yml" => {
            let _ = yaml_rust2::YamlLoader::load_from_str(&content)
                .map_err(|e| AppError::Validation(format!("YAML格式错误: {:?}", e)))?;
        }
        "ini" | "conf" | "properties" => {
            let _ = ini::Ini::load_from_str(&content)
                .map_err(|e| AppError::Validation(format!("INI格式错误: {}", e)))?;
        }
        "xml" => {
            let _ = quick_xml::de::from_str::<serde_json::Value>(&content)
                .map_err(|e| AppError::Validation(format!("XML格式错误: {}", e)))?;
        }
        _ => {}
    }
    Ok(())
}

// ── Project storage ──

fn get_project_store_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let mut path = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::CredentialStore(e.to_string()))?;
    create_dir_all(&path).map_err(|e| AppError::CredentialStore(e.to_string()))?;
    path.push("projects.json");
    Ok(path)
}

#[tauri::command]
pub async fn save_projects(app: AppHandle, data: String) -> Result<(), AppError> {
    let path = get_project_store_path(&app)?;
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)?;
    file.write_all(data.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub async fn load_projects(app: AppHandle) -> Result<String, AppError> {
    let path = get_project_store_path(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    let mut file = File::open(&path)?;
    let mut data = String::new();
    file.read_to_string(&mut data)?;
    Ok(data)
}

// ── Backup operations ──

fn get_backup_dir(app: &AppHandle, env_id: &str) -> Result<PathBuf, AppError> {
    let mut path = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::CredentialStore(e.to_string()))?;
    path.push("backups");
    path.push(env_id);
    create_dir_all(&path).map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, format!("创建备份目录失败: {}", e))))?;
    Ok(path)
}

/// Remove oldest backups exceeding `keep_count`, keeping the most recent ones.
fn cleanup_old_backups(backup_dir: &Path, keep_count: usize) -> Result<(), AppError> {
    if !backup_dir.exists() {
        return Ok(());
    }
    let mut existing: Vec<_> = std::fs::read_dir(backup_dir)
        .map_err(|e| AppError::Io(e))?
        .filter_map(|e| e.ok())
        .filter(|e| e.metadata().map(|m| m.is_file()).unwrap_or(false))
        .collect();
    existing.sort_by_key(|e| {
        e.metadata()
            .map(|m| m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH))
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    if existing.len() > keep_count {
        for old in existing.iter().take(existing.len() - keep_count) {
            let _ = std::fs::remove_file(old.path());
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BackupRecord {
    pub filename: String,
    pub timestamp: String,
    pub size: u64,
}

#[tauri::command]
pub async fn backup_remote_config(
    app: AppHandle,
    env_id: String,
    host: String,
    port: u16,
    username: String,
    private_key_path: Option<String>,
    remote_file_path: String,
) -> Result<Option<BackupRecord>, AppError> {
    tokio::task::spawn_blocking(move || {
        let map = load_credentials(&app);
        let cred = map.get(&env_id).cloned().unwrap_or_default();
        let mut on_hostkey = |_fingerprint: &str| -> Result<(), AppError> { Ok(()) };
        let cache_key = ssh_session::make_cache_key(&host, port, &username, private_key_path.as_deref());
        let mut sess = ssh_session::establish_ssh_session(
            &app, &host, port, &username,
            private_key_path.as_deref(), cred, 8,
            &mut on_hostkey,
        )?;

        // Open SFTP channel with one automatic retry.
        let sftp = match sess.sftp() {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(%cache_key, "SFTP open failed: {}, retrying with fresh session", e);
                ssh_session::evict_session(&app, &cache_key);
                let cred2 = map.get(&env_id).cloned().unwrap_or_default();
                sess = ssh_session::establish_ssh_session(
                    &app, &host, port, &username,
                    private_key_path.as_deref(), cred2, 8,
                    &mut on_hostkey,
                )?;
                sess.sftp()
                    .map_err(|e2| AppError::Sftp(format!("备份SFTP失败(已重试): {}", e2)))?
            }
        };

        let path = Path::new(&remote_file_path);
        let mut file = match sftp.open(path) {
            Ok(f) => f,
            Err(e) => {
                if e.code() == ssh2::ErrorCode::SFTP(2) {
                    drop(sftp);
                    ssh_session::release_session(&app, &cache_key, sess);
                    return Ok(None);
                }
                return Err(AppError::Sftp(format!("备份读取远程文件失败: {}", e)));
            }
        };
        let mut contents = Vec::new();
        file.read_to_end(&mut contents)
            .map_err(|e| AppError::Sftp(format!("备份读取数据流中断: {}", e)))?;

        let backup_dir = get_backup_dir(&app, &env_id)?;
        cleanup_old_backups(&backup_dir, 5)?;
        let base = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("config");
        let ts = chrono::Local::now().format("%Y%m%d_%H%M%S%.3f").to_string();
        let backup_name = format!("{}.{}.bak", base, ts);
        let backup_path = backup_dir.join(&backup_name);

        let mut out = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&backup_path)
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, format!("创建备份文件失败: {}", e))))?;
        out.write_all(&contents)
            .map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, format!("写入备份文件失败: {}", e))))?;

        drop(file);
        drop(sftp);
        ssh_session::release_session(&app, &cache_key, sess);
        Ok(Some(BackupRecord {
            filename: backup_name,
            timestamp: ts,
            size: contents.len() as u64,
        }))
    })
    .await
    .map_err(|e| AppError::SshConnection(e.to_string()))?
}

#[tauri::command]
pub async fn read_backup_content(
    app: AppHandle,
    env_id: String,
    backup_filename: String,
) -> Result<String, AppError> {
    let backup_dir = get_backup_dir(&app, &env_id)?;
    let backup_path = backup_dir.join(&backup_filename);
    let mut file = File::open(&backup_path).map_err(|e| AppError::Io(e))?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).map_err(|e| AppError::Io(e))?;
    Ok(contents)
}

#[tauri::command]
pub async fn list_backups(
    app: AppHandle,
    env_id: String,
) -> Result<Vec<BackupRecord>, AppError> {
    let backup_dir = get_backup_dir(&app, &env_id)?;
    let mut records = Vec::new();
    if backup_dir.exists() {
        for entry in std::fs::read_dir(&backup_dir).map_err(|e| AppError::Io(e))? {
            let entry = entry.map_err(|e| AppError::Io(e))?;
            let meta = entry.metadata().map_err(|e| AppError::Io(e))?;
            if meta.is_file() {
                let fname = entry.file_name().to_string_lossy().to_string();
                // Timestamp format: YYYYMMDD_HHMMSS.fff (19 chars), stored as
                // <base>.<timestamp>.bak  — extract just the timestamp portion.
                let ts = fname
                    .strip_suffix(".bak")
                    .unwrap_or(&fname);
                // Take the last 19 characters (the timestamp)
                let ts = if ts.len() >= 19 {
                    ts[ts.len() - 19..].to_string()
                } else {
                    ts.to_string()
                };
                records.push(BackupRecord {
                    filename: fname,
                    timestamp: ts,
                    size: meta.len(),
                });
            }
        }
    }
    records.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(records)
}

#[tauri::command]
pub async fn restore_backup(
    app: AppHandle,
    env_id: String,
    host: String,
    port: u16,
    username: String,
    private_key_path: Option<String>,
    remote_file_path: String,
    backup_filename: String,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let backup_dir = get_backup_dir(&app, &env_id)?;
        let backup_path = backup_dir.join(&backup_filename);
        let mut file = File::open(&backup_path).map_err(|e| AppError::Io(e))?;
        let mut contents = Vec::new();
        file.read_to_end(&mut contents).map_err(|e| AppError::Io(e))?;

        let map = load_credentials(&app);
        let cred = map.get(&env_id).cloned().unwrap_or_default();
        let mut on_hostkey = |_fingerprint: &str| -> Result<(), AppError> { Ok(()) };
        let cache_key = ssh_session::make_cache_key(&host, port, &username, private_key_path.as_deref());
        let mut sess = ssh_session::establish_ssh_session(
            &app, &host, port, &username,
            private_key_path.as_deref(), cred, 10,
            &mut on_hostkey,
        )?;

        // Open SFTP channel with one automatic retry.
        let sftp = match sess.sftp() {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(%cache_key, "SFTP open failed: {}, retrying with fresh session", e);
                ssh_session::evict_session(&app, &cache_key);
                let cred2 = map.get(&env_id).cloned().unwrap_or_default();
                sess = ssh_session::establish_ssh_session(
                    &app, &host, port, &username,
                    private_key_path.as_deref(), cred2, 10,
                    &mut on_hostkey,
                )?;
                sess.sftp()
                    .map_err(|e2| AppError::Sftp(format!("恢复SFTP失败(已重试): {}", e2)))?
            }
        };

        let path = Path::new(&remote_file_path);
        let mut remote = sftp
            .create(path)
            .map_err(|e| AppError::Sftp(format!("恢复创建远程文件失败: {}", e)))?;
        remote
            .write_all(&contents)
            .map_err(|e| AppError::Sftp(format!("恢复写入远程文件失败: {}", e)))?;
        drop(remote);
        drop(sftp);
        ssh_session::release_session(&app, &cache_key, sess);
        Ok(())
    })
    .await
    .map_err(|e| AppError::SshConnection(e.to_string()))?
}

#[tauri::command]
pub async fn delete_backup(
    app: AppHandle,
    env_id: String,
    backup_filename: String,
) -> Result<(), AppError> {
    let backup_dir = get_backup_dir(&app, &env_id)?;
    let backup_path = backup_dir.join(&backup_filename);
    if backup_path.exists() {
        std::fs::remove_file(&backup_path).map_err(|e| AppError::Io(e))?;
    }
    Ok(())
}

// ── Local file I/O ──

#[tauri::command]
pub fn read_local_file(file_path: String) -> Result<String, AppError> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(AppError::FileNotFound);
    }
    let meta = std::fs::metadata(path)?;
    if meta.len() > MAX_FILE_SIZE {
        return Err(AppError::FileTooLarge(meta.len()));
    }
    let mut file = File::open(path)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    Ok(contents)
}

#[tauri::command]
pub fn write_local_file(
    file_path: String,
    content: String,
    original_ending: String,
) -> Result<(), AppError> {
    let path = Path::new(&file_path);
    if let Some(parent) = path.parent() {
        create_dir_all(parent).map_err(|e| {
            AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, format!("创建本地目录失败: {}", e)))
        })?;
    }
    let processed_content = if original_ending == "CRLF" {
        content.replace('\n', "\r\n")
    } else {
        content.replace("\r\n", "\n")
    };
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|e| {
            AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, format!("打开本地文件失败: {}", e)))
        })?;
    file.write_all(processed_content.as_bytes())
        .map_err(|e| {
            AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, format!("写入本地文件失败: {}", e)))
        })?;
    Ok(())
}

#[tauri::command]
pub fn get_app_config_dir(app: AppHandle) -> Result<String, AppError> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::CredentialStore(e.to_string()))?;
    Ok(path.to_string_lossy().to_string())
}

/// Remove the known_hosts entry for a specific host:port.
/// Called after user accepts a changed host key, before re-connecting.
#[tauri::command]
pub async fn remove_known_host(
    app: AppHandle,
    host: String,
    port: u16,
) -> Result<(), AppError> {
    let mut known_hosts_path = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::CredentialStore(e.to_string()))?;
    known_hosts_path.push("known_hosts");
    crate::known_hosts::remove_host_entry(&known_hosts_path, &host, port)
}
