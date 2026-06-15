use std::fs;
use std::path::PathBuf;
use ssh2::{CheckResult, HostKeyType, KnownHostFileKind, KnownHostKeyFormat, Session};

use crate::error::AppError;

fn host_key_info(key_type: HostKeyType) -> (&'static str, KnownHostKeyFormat) {
    match key_type {
        HostKeyType::Rsa => ("ssh-rsa", KnownHostKeyFormat::SshRsa),
        HostKeyType::Dss => ("ssh-dss", KnownHostKeyFormat::SshDss),
        HostKeyType::Ecdsa256 => ("ecdsa-sha2-nistp256", KnownHostKeyFormat::Ecdsa256),
        HostKeyType::Ecdsa384 => ("ecdsa-sha2-nistp384", KnownHostKeyFormat::Ecdsa384),
        HostKeyType::Ecdsa521 => ("ecdsa-sha2-nistp521", KnownHostKeyFormat::Ecdsa521),
        HostKeyType::Ed25519 => ("ssh-ed25519", KnownHostKeyFormat::Ed25519),
        HostKeyType::Unknown => ("ssh-unknown", KnownHostKeyFormat::Unknown),
    }
}

pub fn check_host_key(
    session: &mut Session,
    host: &str,
    port: u16,
    known_hosts_path: &PathBuf,
) -> Result<bool, AppError> {
    let mut known_hosts = session
        .known_hosts()
        .map_err(|e| AppError::SshConnection(e.to_string()))?;

    if known_hosts_path.exists() {
        known_hosts
            .read_file(known_hosts_path, KnownHostFileKind::OpenSSH)
            .map_err(|e| AppError::SshConnection(e.to_string()))?;
    }

    let (key, _key_type) = session
        .host_key()
        .ok_or_else(|| AppError::InvalidHostKey("主机未提供host key".to_string()))?;
    let host_port = format!("[{}]:{}", host, port);

    match known_hosts.check(&host_port, &key) {
        CheckResult::Match => Ok(true),
        CheckResult::Mismatch => {
            let fp = get_host_key_fingerprint(session)
                .unwrap_or_else(|| "无法获取指纹".to_string());
            Err(AppError::InvalidHostKey(fp))
        }
        CheckResult::NotFound => Ok(false),
        CheckResult::Failure => Err(AppError::SshConnection("Host key check failure".to_string())),
    }
}

pub fn add_host_key(
    session: &mut Session,
    host: &str,
    port: u16,
    known_hosts_path: &PathBuf,
) -> Result<(), AppError> {
    let mut known_hosts = session
        .known_hosts()
        .map_err(|e| AppError::SshConnection(e.to_string()))?;

    let (key, key_type) = session
        .host_key()
        .ok_or_else(|| AppError::InvalidHostKey("添加时主机未提供host key".to_string()))?;
    let host_port = format!("[{}]:{}", host, port);
    let (key_type_str, key_format) = host_key_info(key_type);

    known_hosts
        .add(&host_port, &key, key_type_str, key_format)
        .map_err(|e| AppError::SshConnection(format!("添加host key失败: {}", e)))?;

    // Write the known_hosts to file
    let file_path = known_hosts_path.as_path();
    known_hosts
        .write_file(file_path, KnownHostFileKind::OpenSSH)
        .map_err(|e| AppError::SshConnection(e.to_string()))?;
    Ok(())
}

pub fn get_host_key_fingerprint(session: &Session) -> Option<String> {
    session.host_key_hash(ssh2::HashType::Sha256).map(|hash| {
        let mut s = String::new();
        for b in hash {
            s.push_str(&format!("{:02x}", b));
        }
        s
    })
}

/// Remove all host key entries matching host:port from the known_hosts file.
/// This is used when the user accepts a changed host key.
pub fn remove_host_entry(known_hosts_path: &PathBuf, host: &str, port: u16) -> Result<(), AppError> {
    if !known_hosts_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(known_hosts_path)
        .map_err(|e| AppError::Io(e))?;

    let host_port = format!("[{}]:{}", host, port);

    let filtered: Vec<&str> = content
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            // Keep empty lines and comments
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return true;
            }
            // Remove lines that start with [host]:port
            !trimmed.starts_with(&host_port)
        })
        .collect();

    let new_content = filtered.join("\n");
    // Preserve trailing newline if original had one
    let new_content = if content.ends_with('\n') {
        new_content + "\n"
    } else {
        new_content
    };

    fs::write(known_hosts_path, new_content)
        .map_err(|e| AppError::Io(e))?;

    Ok(())
}
