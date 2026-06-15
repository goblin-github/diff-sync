use serde::{Serialize, Serializer};
use std::fmt;

#[derive(Debug)]
pub enum AppError {
    SshConnection(String),
    Sftp(String),
    InvalidHostKey(String),
    FileTooLarge(u64),
    FileNotFound,
    Validation(String),
    CredentialStore(String),
    Io(std::io::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let (code, message) = self.to_code_message();
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", &code)?;
        state.serialize_field("message", &message)?;
        state.end()
    }
}

impl AppError {
    pub fn to_code_message(&self) -> (u16, String) {
        match self {
            AppError::SshConnection(e) => (1001, format!("SSH连接失败: {}", e)),
            AppError::Sftp(e) => (1002, format!("SFTP错误: {}", e)),
            AppError::InvalidHostKey(fp) => (1003, fp.clone()),
            AppError::FileTooLarge(size) => (1004, format!("文件过大({}字节)，超过5MB限制", size)),
            AppError::FileNotFound => (1005, "ERR_FILE_NOT_FOUND".to_string()),
            AppError::Validation(e) => (1006, e.clone()),
            AppError::CredentialStore(e) => (1007, e.clone()),
            AppError::Io(e) => (1008, e.to_string()),
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (_, message) = self.to_code_message();
        write!(f, "{}", message)
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e)
    }
}
