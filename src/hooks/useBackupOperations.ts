import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import { Environment, BackupRecord, getRemoteFilePath } from '../types';
import { normalizeLineEndings, parseAppError } from '../utils/formatHelper';

export interface UseBackupOperationsOptions {
  activeEnv: Environment | null;
  originalEnding: 'LF' | 'CRLF';
  isLocked: (envId: string) => boolean;
  setStatus: (msg: string) => void;
  /** Called when a backup is successfully restored to remote — parent updates editor state. */
  onRestoreBackup: (content: string) => void;
}

export interface UseBackupOperationsReturn {
  backupRecords: BackupRecord[];
  showBackupRestore: boolean;
  backupContent: string | null;
  isViewingBackup: boolean;
  setIsViewingBackup: React.Dispatch<React.SetStateAction<boolean>>;
  loadBackupList: () => Promise<void>;
  handleLoadBackupForDiff: (backupFilename: string) => Promise<void>;
  handleSwitchToRemote: () => void;
  handleRestoreBackup: (contentOverride?: string) => Promise<void>;
  handleDeleteBackup: (backupFilename: string) => Promise<void>;
  toggleBackupPanel: () => Promise<void>;
  resetBackupState: () => void;
}

export function useBackupOperations(
  opts: UseBackupOperationsOptions,
): UseBackupOperationsReturn {
  const { activeEnv, originalEnding, isLocked, setStatus, onRestoreBackup } = opts;

  const [backupRecords, setBackupRecords] = useState<BackupRecord[]>([]);
  const [showBackupRestore, setShowBackupRestore] = useState(false);
  const [backupContent, setBackupContent] = useState<string | null>(null);
  const [isViewingBackup, setIsViewingBackup] = useState(false);

  const resetBackupState = useCallback(() => {
    setShowBackupRestore(false);
    setBackupRecords([]);
    setBackupContent(null);
    setIsViewingBackup(false);
  }, []);

  const loadBackupList = useCallback(async () => {
    if (!activeEnv) return;
    try {
      const records = await invoke<BackupRecord[]>('list_backups', {
        envId: activeEnv.id,
      });
      setBackupRecords(records);
    } catch (_) {
      // backup list load failed — non-critical, silently ignore
    }
  }, [activeEnv]);

  const handleLoadBackupForDiff = useCallback(
    async (backupFilename: string) => {
      if (!activeEnv) return;
      setStatus('正在加载备份内容...');
      try {
        const content = await invoke<string>('read_backup_content', {
          envId: activeEnv.id,
          backupFilename,
        });
        const normalized = normalizeLineEndings(content);
        setBackupContent(normalized);
        setIsViewingBackup(true);
        setStatus(
          `📂 已加载备份: ${backupFilename} | 比对视图: 远端(左) ↔ 备份(右)`,
        );
      } catch (err: any) {
        setStatus(`❌ 读取备份失败: ${err.message || err}`);
      }
    },
    [activeEnv, setStatus],
  );

  const handleSwitchToRemote = useCallback(() => {
    setIsViewingBackup(false);
    setStatus('已关闭备份比对');
  }, [setStatus]);

  const handleRestoreBackup = useCallback(async (contentOverride?: string) => {
    const contentToRestore = contentOverride ?? backupContent;
    if (!activeEnv || !contentToRestore) return;
    if (activeEnv.isProduction && isLocked(activeEnv.id)) {
      setStatus('❌ 恢复受阻: 生产环境处于锁定状态，请先在面板解锁。');
      return;
    }
    if (activeEnv.isProduction) {
      const isModified = contentOverride !== undefined && contentOverride !== backupContent;
      const msg = isModified
        ? '即将用修改后的内容覆盖生产环境远端配置，操作将实时生效。是否确定？'
        : '即将用备份内容覆盖生产环境远端配置，操作将实时生效。是否确定？';
      const doubleCheck = await confirm(
        msg,
        { title: '⚠️ 生产环境安全验证', kind: 'warning' },
      );
      if (!doubleCheck) return;
    }
    setStatus('正在用备份覆盖远端配置...');
    try {
      await invoke('write_remote_config', {
        envId: activeEnv.id,
        host: activeEnv.sshConfig.host,
        port: activeEnv.sshConfig.port,
        username: activeEnv.sshConfig.username,
        privateKeyPath:
          activeEnv.sshConfig.authType === 'key'
            ? activeEnv.sshConfig.privateKeyPath
            : null,
        remoteFilePath: getRemoteFilePath(activeEnv),
        content: contentToRestore,
        originalEnding,
      });
      onRestoreBackup(contentToRestore);
      setStatus(`🟢 备份已恢复至远端 (${new Date().toLocaleTimeString()})`);
    } catch (err: unknown) {
      const errObj = parseAppError(err);
      setStatus(`❌ 备份恢复失败: ${errObj.message}`);
    }
  }, [activeEnv, backupContent, originalEnding, isLocked, setStatus, onRestoreBackup]);
  // Note: contentOverride is a call-time parameter, not a hook dependency.

  const handleDeleteBackup = useCallback(
    async (backupFilename: string) => {
      if (!activeEnv) return;
      const ok = await confirm(
        `确定要删除备份 ${backupFilename} 吗？此操作不可恢复。`,
        { title: '确认删除备份', kind: 'warning' },
      );
      if (!ok) return;
      try {
        await invoke('delete_backup', { envId: activeEnv.id, backupFilename });
        setBackupRecords((prev) => prev.filter((r) => r.filename !== backupFilename));
        setStatus(`已删除备份: ${backupFilename}`);
      } catch (err: any) {
        setStatus(`❌ 删除失败: ${err.message || err}`);
      }
    },
    [activeEnv, setStatus],
  );

  const toggleBackupPanel = useCallback(async () => {
    if (!showBackupRestore) await loadBackupList();
    setShowBackupRestore((prev) => !prev);
  }, [showBackupRestore, loadBackupList]);

  return {
    backupRecords,
    showBackupRestore,
    backupContent,
    isViewingBackup,
    setIsViewingBackup,
    loadBackupList,
    handleLoadBackupForDiff,
    handleSwitchToRemote,
    handleRestoreBackup,
    handleDeleteBackup,
    toggleBackupPanel,
    resetBackupState,
  };
}
