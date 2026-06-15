use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use ssh2::{Session, Sftp};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use zeroize::Zeroizing;

use crate::error::AppError;
use crate::known_hosts::{add_host_key, check_host_key, get_host_key_fingerprint};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct EnvCredential {
    pub password: Option<String>,
    pub private_key_passphrase: Option<String>,
}

/// TTL for cached SSH sessions — avoids redundant handshake on adjacent operations
/// (e.g. open-environment → edit → push within 2 minutes).
const SESSION_CACHE_TTL: Duration = Duration::from_secs(120);

/// Build a deterministic cache key from connection parameters.
pub fn make_cache_key(host: &str, port: u16, username: &str, private_key_path: Option<&str>) -> String {
    format!(
        "{}:{}:{}:{}",
        host,
        port,
        username,
        private_key_path.unwrap_or("")
    )
}

struct CachedSession {
    session: Session,
    cached_at: Instant,
}

/// Lightweight SSH session pool with TTL-based eviction.
///
/// Registered as Tauri managed state so every blocking command can
/// borrow/release sessions without re-authenticating on each call.
pub struct SessionPool {
    cache: Mutex<HashMap<String, CachedSession>>,
}

impl SessionPool {
    pub fn new() -> Self {
        tracing::info!(
            "🚀 SessionPool initialized — SSH connections will be cached for {}s",
            SESSION_CACHE_TTL.as_secs()
        );
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }
}

/// Try to pull a still-valid session from the pool.
///
/// Returns `None` when the pool is not registered, the key is absent,
/// the TTL has expired, or the underlying connection has dropped.
pub fn acquire_session(app: &AppHandle, cache_key: &str) -> Option<Session> {
    let pool = app.try_state::<SessionPool>()?;
    let mut cache = pool.cache.lock().unwrap();
    let entry = cache.remove(cache_key)?;
    let age = entry.cached_at.elapsed();
    let still_auth = entry.session.authenticated();
    let fresh = age < SESSION_CACHE_TTL && still_auth;
    tracing::info!(
        cache_key = %cache_key,
        age_secs = age.as_secs(),
        ttl_secs = SESSION_CACHE_TTL.as_secs(),
        still_authenticated = still_auth,
        reused = fresh,
        "SessionPool::acquire"
    );
    if fresh {
        Some(entry.session)
    } else {
        None
    }
}

/// Return a session to the pool so a subsequent operation can reuse it.
///
/// Evicts all expired entries while holding the lock (lazy cleanup).
pub fn release_session(app: &AppHandle, cache_key: &str, session: Session) {
    if let Some(pool) = app.try_state::<SessionPool>() {
        let mut cache = pool.cache.lock().unwrap();
        let before = cache.len();
        cache.retain(|_, v| v.cached_at.elapsed() < SESSION_CACHE_TTL);
        let evicted = before - cache.len();
        cache.insert(
            cache_key.to_string(),
            CachedSession {
                session,
                cached_at: Instant::now(),
            },
        );
        tracing::info!(
            cache_key = %cache_key,
            pool_size = cache.len(),
            evicted,
            "SessionPool::release"
        );
    }
}

/// Detect SSH_AUTH_SOCK from shell environment (macOS GUI apps don't inherit it).
pub fn ensure_ssh_auth_sock() {
    if std::env::var("SSH_AUTH_SOCK").map_or(true, |s| s.is_empty()) {
        let candidates = [
            || {
                Command::new("zsh")
                    .arg("-l")
                    .arg("-c")
                    .arg("echo -n $SSH_AUTH_SOCK")
                    .output()
                    .ok()
                    .and_then(|o| {
                        let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        if s.is_empty() { None } else { Some(s) }
                    })
            },
            || {
                Command::new("bash")
                    .arg("-l")
                    .arg("-c")
                    .arg("echo -n $SSH_AUTH_SOCK")
                    .output()
                    .ok()
                    .and_then(|o| {
                        let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        if s.is_empty() { None } else { Some(s) }
                    })
            },
        ];
        for probe in candidates {
            if let Some(sock) = probe() {
                std::env::set_var("SSH_AUTH_SOCK", sock);
                return;
            }
        }
    }
}

/// Load private key into ssh-agent temporarily so agent-auth can use RSA-SHA2 correctly.
pub fn load_key_into_agent(key_path: &Path, passphrase: &str) -> Result<(), String> {
    use std::io::Write;
    use std::process::Stdio;

    let mut child = Command::new("ssh-add")
        .arg(key_path)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("ssh-add 启动失败: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(passphrase.as_bytes());
        let _ = stdin.write_all(b"\n");
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("ssh-add 等待失败: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("ssh-add 失败: {}", err.trim()))
    }
}

impl From<std::string::FromUtf8Error> for AppError {
    fn from(_e: std::string::FromUtf8Error) -> Self {
        AppError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, "UTF-8转换失败"))
    }
}

/// Establish an authenticated SSH session with host-key verification and layered auth.
pub fn establish_ssh_session(
    app: &AppHandle,
    host: &str,
    port: u16,
    username: &str,
    private_key_path: Option<&str>,
    credential: EnvCredential,
    timeout_secs: u64,
    on_unrecognized_hostkey: &mut dyn FnMut(&str) -> Result<(), AppError>,
) -> Result<Session, AppError> {
    let cache_key = make_cache_key(host, port, username, private_key_path);
    if let Some(sess) = acquire_session(app, &cache_key) {
        tracing::info!(%cache_key, "SSH session REUSED from pool — skipping handshake");
        let _ = app.emit("ssh-pool-status", serde_json::json!({
            "reused": true,
            "cacheKey": cache_key,
            "message": "♻️ 复用已缓存连接，跳过握手"
        }));
        return Ok(sess);
    }
    let _ = app.emit("ssh-pool-status", serde_json::json!({
        "reused": false,
        "cacheKey": cache_key,
        "message": "🔗 正在建立新连接 (TCP+握手+认证)"
    }));
    tracing::info!(%cache_key, "SSH session NOT in pool — establishing new connection");

    let addrs = format!("{}:{}", host, port)
        .to_socket_addrs()
        .map_err(|e| AppError::SshConnection(format!("主机名解析失败: {}", e)))?;
    let socket_addr = addrs
        .into_iter()
        .next()
        .ok_or_else(|| AppError::SshConnection("无法获取解析的IP终结点".to_string()))?;
    let tcp = TcpStream::connect_timeout(&socket_addr, Duration::from_secs(timeout_secs))
        .map_err(|e| {
            AppError::SshConnection(format!("TCP连接超时 ({}秒): {}", timeout_secs, e))
        })?;

    let mut sess =
        Session::new().map_err(|e| AppError::SshConnection(format!("会话初始化失败: {}", e)))?;
    sess.set_tcp_stream(tcp);
    sess.set_timeout(30_000);
    sess.handshake()
        .map_err(|e| AppError::SshConnection(format!("SSH握手失败: {}", e)))?;

    // Host key verification
    let mut known_hosts_path = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::CredentialStore(e.to_string()))?;
    known_hosts_path.push("known_hosts");
    match check_host_key(&mut sess, host, port, &known_hosts_path) {
        Ok(true) => {}
        Ok(false) => {
            let fingerprint = get_host_key_fingerprint(&sess)
                .ok_or_else(|| AppError::InvalidHostKey("无法获取主机指纹".to_string()))?;
            on_unrecognized_hostkey(&fingerprint)?;
            add_host_key(&mut sess, host, port, &known_hosts_path)?;
        }
        Err(e) => return Err(e),
    }

    // Authentication — layered fallback strategy
    let mut authenticated = false;
    ensure_ssh_auth_sock();

    // Layer 1: SSH Agent
    if !authenticated {
        if let Some(key_path) = private_key_path {
            let passphrase = credential.private_key_passphrase.as_deref().unwrap_or("");
            let loaded = load_key_into_agent(Path::new(key_path), passphrase);
            if loaded.is_err() {
                // key might already be in agent, try anyway
            }
        }
        match sess.userauth_agent(username) {
            Ok(()) => { authenticated = sess.authenticated(); }
            Err(_) => {}
        }
    }

    // Layer 2: Explicit private key file
    if !authenticated {
        if let Some(key_path) = private_key_path {
            let path = Path::new(key_path);
            let passphrase = credential.private_key_passphrase.as_deref().unwrap_or("");
            let pubkey_path = {
                let mut p = path.to_path_buf();
                let mut pub_ext = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                pub_ext.push_str(".pub");
                p.set_file_name(&pub_ext);
                if p.exists() { Some(p) } else { None }
            };

            let result = if let Some(ref pub_p) = pubkey_path {
                sess.userauth_pubkey_file(username, Some(pub_p.as_path()), path, Some(passphrase))
            } else {
                sess.userauth_pubkey_file(username, None, path, Some(passphrase))
            };

            match result {
                Ok(()) => { authenticated = sess.authenticated(); }
                Err(e) => {
                    let retry = if !passphrase.is_empty() {
                        if let Some(ref pub_p) = pubkey_path {
                            sess.userauth_pubkey_file(username, Some(pub_p.as_path()), path, None)
                        } else {
                            sess.userauth_pubkey_file(username, None, path, None)
                        }
                    } else {
                        Err(e)
                    };

                    match retry {
                        Ok(()) => { authenticated = sess.authenticated(); }
                        Err(e2) => {
                            let err_msg = format!("{}", e2);
                            let key_type_hint = std::fs::read_to_string(path).ok().and_then(|k| {
                                k.lines().next().map(|l| l.to_string())
                            });
                            let is_rsa = key_type_hint.as_ref().map_or(false, |l| l.contains("RSA"));
                            let is_pem = key_type_hint.as_ref().map_or(false, |l| l.contains("BEGIN") && !l.contains("OPENSSH"));
                            let is_openssh = key_type_hint.as_ref().map_or(false, |l| l.contains("OPENSSH PRIVATE KEY"));

                            let mut hints: Vec<String> = Vec::new();
                            if is_openssh {
                                hints.push("密钥格式: OpenSSH 新格式 (libssh2 可能不支持)".to_string());
                                hints.push("→ 解决: ssh-keygen -p -m PEM -f <密钥文件>".to_string());
                            }
                            if is_rsa && is_pem {
                                hints.push("密钥类型: RSA PEM (格式正确，但服务器可能拒绝 RSA/SHA-1)".to_string());
                                hints.push("→ libssh2 可能未正确回退到 RSA-SHA2-256/512".to_string());
                                hints.push("→ 程序已尝试通过 ssh-add 加载密钥到 agent，请确认 ssh-agent 中是否有正确的密钥".to_string());
                            }
                            hints.push(format!("→ 终端测试: ssh -i {} {}@{} -p {}", key_path, username, host, port));
                            hints.push("→ 检查: 用户名、authorized_keys、密钥密码".to_string());

                            return Err(AppError::SshConnection(format!(
                                "密钥认证失败: {}\n\n诊断:\n{}",
                                err_msg,
                                hints.iter()
                                    .enumerate()
                                    .map(|(i, h)| format!("{}. {}", i + 1, h))
                                    .collect::<Vec<_>>()
                                    .join("\n")
                            )));
                        }
                    }
                }
            }
        }
    }

    // Layer 3: Password authentication
    if !authenticated {
        if let Some(ref pwd) = credential.password {
            let zero_pwd = Zeroizing::new(pwd.clone());
            match sess.userauth_password(username, &zero_pwd) {
                Ok(()) => { authenticated = sess.authenticated(); }
                Err(e) => {
                    return Err(AppError::SshConnection(format!("密码认证失败: {}", e)));
                }
            }
        }
    }

    if !authenticated {
        if private_key_path.is_some() || credential.private_key_passphrase.is_some() {
            let agent_attempted = std::env::var("SSH_AUTH_SOCK").map_or(false, |s| !s.is_empty());
            let mut hints = Vec::new();
            hints.push(format!("SSH Agent 尝试: {}", if agent_attempted { "已尝试" } else { "未检测到 (ssh-agent 未运行或 socket 未找到)" }));
            hints.push("请在终端运行验证: ssh -i <密钥文件> <用户名>@<主机> -p <端口>".to_string());
            hints.push("如果终端可以连接: 运行 ssh-add <密钥文件> 将密钥加载到 ssh-agent".to_string());
            hints.push("检查: 用户名是否正确、密钥是否在服务器 authorized_keys 中".to_string());
            return Err(AppError::SshConnection(
                format!("所有认证方式均失败。\n\n诊断:\n{}",
                    hints.iter().enumerate().map(|(i, h)| format!("{}. {}", i + 1, h)).collect::<Vec<_>>().join("\n"))
            ));
        } else if credential.password.is_some() {
            return Err(AppError::SshConnection("密码认证失败，请检查用户名和密码".to_string()));
        } else {
            return Err(AppError::SshConnection("缺少可用的授权模式".to_string()));
        }
    }
    Ok(sess)
}

/// Recursively create remote directories if they don't exist.
pub fn ensure_remote_dir_exists(sftp: &Sftp, file_path: &Path) -> Result<(), AppError> {
    if let Some(parent) = file_path.parent() {
        let mut current = PathBuf::new();
        for component in parent.components() {
            current.push(component);
            if current == Path::new("/") {
                continue;
            }
            if sftp.stat(&current).is_err() {
                sftp.mkdir(&current, 0o755)
                    .map_err(|e| AppError::Sftp(format!("递归创建远程路径失败: {}", e)))?;
            }
        }
    }
    Ok(())
}
