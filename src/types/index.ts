export interface AppStorage {
  version: number;
  projects: Project[];
  activeProjectId: string | null;
  activeEnvId: string | null;
  settings?: AppSettings;
}

export interface AppSettings {
  lockTimeoutMinutes: number;
  /** Whether the production safety lock is enabled. Default true. */
  lockEnabled?: boolean;
  /** Allow editing local file in the diff editor. Default false. */
  localEditable?: boolean;
}

export interface Project {
  id: string;
  name: string;
  environments: Environment[];
}

export interface Environment {
  id: string;
  name: string;
  isProduction: boolean;
  localFilePath: string;
  /** Remote directory path, e.g. /etc/app */
  remoteFolderPath: string;
  /** Remote config file name, e.g. config.yml */
  remoteFileName: string;
  sshConfig: SSHConfig;
  backupEnabled: boolean;
}

export interface BackupRecord {
  filename: string;
  timestamp: string;
  size: number;
}

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  authType: 'key' | 'password';
  privateKeyPath?: string;
}

/** Compute full remote file path from folder + filename */
export function getRemoteFilePath(env: Environment): string {
  const folder = (env.remoteFolderPath || '').replace(/\/+$/, '');
  const file = (env.remoteFileName || '').replace(/^\/+/, '');
  return `${folder}/${file}`;
}

/** Get basename from a file path */
export function getFileBaseName(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || 'config';
}

/** Get directory path from a file path */
export function getFileDirName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash > 0 ? normalized.substring(0, lastSlash) : '';
}

/** Migrate old Environment format that had remoteFilePath in sshConfig */
export function migrateEnvironment(env: any): Environment {
  // If already has new fields, return as-is
  if (env.remoteFolderPath !== undefined && env.remoteFileName !== undefined) {
    return env as Environment;
  }
  // Migrate from old format
  const oldRemotePath: string = env.sshConfig?.remoteFilePath || '';
  return {
    ...env,
    remoteFolderPath: getFileDirName(oldRemotePath),
    remoteFileName: getFileBaseName(oldRemotePath) || getFileBaseName(env.localFilePath || ''),
    sshConfig: {
      host: env.sshConfig?.host || '',
      port: env.sshConfig?.port || 22,
      username: env.sshConfig?.username || '',
      authType: env.sshConfig?.authType || 'password',
      privateKeyPath: env.sshConfig?.privateKeyPath,
    },
  };
}
