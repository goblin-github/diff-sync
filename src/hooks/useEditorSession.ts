import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import type { editor, IDisposable } from 'monaco-editor';
import { Environment, BackupRecord, getRemoteFilePath } from '../types';
import { readLocalFile, writeLocalFile } from '../services/tauriFs';
import { normalizeLineEndings, getLanguageByPath, parseAppError } from '../utils/formatHelper';
import { useBackupOperations } from './useBackupOperations';

/** Private symbol to store subscription handles on Monaco editor instances. */
const SUB_KEY = '__diffsync_subs__';

interface EditorWithSubs extends editor.IStandaloneDiffEditor {
  [SUB_KEY]?: IDisposable[];
}

export interface UseEditorSessionOptions {
  setProjects: React.Dispatch<React.SetStateAction<import('../types').Project[]>>;
  activeProjectId: string | null;
  activeEnvId: string | null;
  setActiveEnvId: React.Dispatch<React.SetStateAction<string | null>>;
  lockEnabled: boolean;
  localEditable: boolean;
  isLocked: (envId: string) => boolean;
  resetLock: (envId: string) => void;
  setStatus: (msg: string) => void;
}

export interface UseEditorSessionReturn {
  activeEnv: Environment | null;
  originalContent: string;
  modifiedContent: string;
  originalEnding: 'LF' | 'CRLF';
  isDirty: boolean;
  isLoading: boolean;
  isInitializing: boolean;
  diffStats: { added: number; removed: number };
  pendingSwitchEnv: Environment | null;
  // Backup state
  backupRecords: BackupRecord[];
  showBackupRestore: boolean;
  backupContent: string | null;
  isViewingBackup: boolean;
  // Editor refs
  editorRef: React.MutableRefObject<editor.IStandaloneDiffEditor | null>;
  // Language helper
  getEditorLanguage: () => string;
  // Operations
  handleSaveLocal: () => Promise<void>;
  handlePushConfig: () => Promise<boolean>;
  handleEnvironmentSwitch: (targetEnv: Environment) => Promise<void>;
  handleOneKeyInitialize: () => Promise<void>;
  handleDiffEditorMount: (editor: any) => void;
  // Pending switch
  setPendingSwitchEnv: React.Dispatch<React.SetStateAction<Environment | null>>;
  handleSaveAndSwitch: () => Promise<void>;
  handleDiscardAndSwitch: () => Promise<void>;
  handleCancelSwitch: () => void;
  // Backup operations
  loadBackupList: () => Promise<void>;
  handleLoadBackupForDiff: (backupFilename: string) => Promise<void>;
  handleSwitchToRemote: () => void;
  handleRestoreBackup: (contentOverride?: string) => Promise<void>;
  handleDeleteBackup: (backupFilename: string) => Promise<void>;
  toggleBackupPanel: () => Promise<void>;
  resetActiveEnv: () => void;
}

// Compare ignoring trailing newlines — Monaco may auto-normalize these on load
const trimTrailingNL = (s: string) => s.replace(/[\r\n]+$/, '');

export function useEditorSession(opts: UseEditorSessionOptions): UseEditorSessionReturn {
  const {
    setActiveEnvId,
    isLocked,
    resetLock,
    setStatus,
  } = opts;

  const [activeEnv, setActiveEnv] = useState<Environment | null>(null);
  const [originalContent, setOriginalContent] = useState('');
  const [modifiedContent, setModifiedContent] = useState('');
  const [originalEnding, setOriginalEnding] = useState<'LF' | 'CRLF'>('LF');
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [diffStats, setDiffStats] = useState({ added: 0, removed: 0 });
  const [pendingSwitchEnv, setPendingSwitchEnv] = useState<Environment | null>(null);

  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const committedOriginal = useRef('');
  const committedModified = useRef('');

  const cleanupEditor = useCallback(() => {
    if (editorRef.current) {
      const subs = (editorRef.current as EditorWithSubs)[SUB_KEY];
      if (subs) {
        subs.forEach((s: IDisposable) => s.dispose());
      }
      editorRef.current = null;
    }
    setDiffStats({ added: 0, removed: 0 });
  }, []);

  const resetActiveEnv = useCallback(() => {
    cleanupEditor();
    setActiveEnv(null);
    setOriginalContent('');
    setModifiedContent('');
    setIsDirty(false);
    setIsLoading(false);
    setIsInitializing(false);
  }, [cleanupEditor]);

  // ── Backup Operations (extracted hook) ──

  const onRestoreBackup = useCallback(
    (content: string) => {
      committedModified.current = content;
      setModifiedContent(content);
      setIsDirty(false);
      setIsViewingBackup(false);
    },
    [],
  );

  const backup = useBackupOperations({
    activeEnv,
    originalEnding,
    isLocked,
    setStatus,
    onRestoreBackup,
  });

  // Destructure for convenience — keep the same names as before
  const {
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
  } = backup;

  // ── Shared validation helper ──

  const validateEditorContent = useCallback(
    async (content: string, filePath: string, action: string): Promise<boolean> => {
      try {
        await invoke('validate_config_format', { content, filePath });
        return true;
      } catch (err: unknown) {
        const errObj = parseAppError(err);
        setStatus(`❌ ${action}受阻 (语法解析失败): ${errObj.message}`);
        return false;
      }
    },
    [setStatus],
  );

  // ── Environment Switch ──

  const executeEnvironmentSwitch = useCallback(
    async (targetEnv: Environment, retryCount = 0): Promise<void> => {
      const MAX_RETRIES = 2;
      // Clean up old environment's lock timer before switching
      if (activeEnv?.isProduction) {
        resetLock(activeEnv.id);
      }
      setDiffStats({ added: 0, removed: 0 });
      setIsDirty(false);
      resetBackupState();
      if (targetEnv.isProduction) {
        resetLock(targetEnv.id);
      }
      setActiveEnvId(targetEnv.id);
      setActiveEnv(targetEnv);
      setIsInitializing(false);
      setIsLoading(true);
      setStatus('🔗 正在连接远程主机...');
      try {
        // Read local file first (don't let remote failure lose local content)
        let localRes: string;
        try {
          setStatus('📂 正在读取本地文件...');
          localRes = await readLocalFile(targetEnv.localFilePath);
        } catch (localErr: any) {
          setStatus(`❌ 本地读取失败: ${localErr.message || localErr}`);
          setIsLoading(false);
          return;
        }
        const normLocal = normalizeLineEndings(localRes);
        committedOriginal.current = normLocal;
        setOriginalContent(normLocal);

        // Read remote file
        try {
          setStatus('📥 正在读取远程文件...');
          const remoteRes = await invoke<[string, string]>('read_remote_config', {
            envId: targetEnv.id,
            host: targetEnv.sshConfig.host,
            port: targetEnv.sshConfig.port,
            username: targetEnv.sshConfig.username,
            privateKeyPath:
              targetEnv.sshConfig.authType === 'key'
                ? targetEnv.sshConfig.privateKeyPath
                : null,
            remoteFilePath: getRemoteFilePath(targetEnv),
          });
          const normRemote = normalizeLineEndings(remoteRes[0]);
          committedModified.current = normRemote;
          setModifiedContent(normRemote);
          setOriginalEnding(remoteRes[1] as 'LF' | 'CRLF');
          setStatus(
            `🟢 连接就绪: ${targetEnv.name} 双端载入完毕 (远端格式: ${remoteRes[1]})`
          );
        } catch (remoteErr: unknown) {
          const errObj = parseAppError(remoteErr);
          if (errObj.code === 1005) {
            setIsInitializing(true);
            committedModified.current = '';
            setModifiedContent('');
            setStatus('⚠️ 远程未检测到配置文件，已激活"一键初始化"引导。');
          } else if (errObj.code === 1004) {
            committedModified.current = '';
            setModifiedContent('');
            setStatus(`❌ 读取异常: ${errObj.message}`);
          } else if (errObj.code === 1003) {
            if (retryCount >= MAX_RETRIES) {
              committedModified.current = '';
              setModifiedContent('');
              setStatus('❌ 主机密钥验证失败，已达最大重试次数。请检查远程主机配置。');
              return;
            }
            const accept = await confirm(
              `远程主机密钥指纹已变更:\n${errObj.message}\n\n是否接受新密钥并继续？`,
              { title: '⚠️ 主机密钥变更', kind: 'warning' }
            );
            if (accept) {
              try {
                await invoke('remove_known_host', {
                  host: targetEnv.sshConfig.host,
                  port: targetEnv.sshConfig.port,
                });
              } catch (_) {}
              return await executeEnvironmentSwitch(targetEnv, retryCount + 1);
            }
            committedModified.current = '';
            setModifiedContent('');
          } else {
            committedModified.current = '';
            setModifiedContent('');
            setStatus(`❌ 管道异常: ${errObj.message}`);
          }
        }
      } finally {
        setIsLoading(false);
      }
    },
    [setStatus, resetLock, setActiveEnvId, activeEnv],
  );

  const handleEnvironmentSwitch = useCallback(
    async (targetEnv: Environment) => {
      if (isDirty) {
        setPendingSwitchEnv(targetEnv);
        return;
      }
      await executeEnvironmentSwitch(targetEnv);
    },
    [isDirty, executeEnvironmentSwitch],
  );

  // ── Pending Switch Handlers ──

  const handleSaveAndSwitch = useCallback(async () => {
    if (!pendingSwitchEnv) return;
    const targetEnv = pendingSwitchEnv;
    const success = await handlePushConfig();
    if (success) {
      setPendingSwitchEnv(null);
      await executeEnvironmentSwitch(targetEnv);
    }
  // We intentionally exclude handlePushConfig & executeEnvironmentSwitch from deps.
  // These are recreated on state changes (isLocked, diffStats, etc.) but read from
  // editorRef/pendingSwitchEnv directly, so a stale closure is harmless here.
  }, [pendingSwitchEnv]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDiscardAndSwitch = useCallback(async () => {
    if (!pendingSwitchEnv) return;
    const env = pendingSwitchEnv;
    setPendingSwitchEnv(null);
    setIsDirty(false);
    await executeEnvironmentSwitch(env);
  }, [pendingSwitchEnv, executeEnvironmentSwitch]);

  const handleCancelSwitch = useCallback(() => {
    setPendingSwitchEnv(null);
  }, []);

  // ── One-Key Initialize ──

  const handleOneKeyInitialize = useCallback(async () => {
    // If modified panel has content different from original, confirm overwrite
    if (modifiedContent.trim() && modifiedContent !== originalContent) {
      const ok = await confirm(
        '远端编辑器已有未保存的内容，初始化将用本地内容覆盖。是否继续？',
        { title: '确认初始化', kind: 'warning' }
      );
      if (!ok) return;
    }
    committedModified.current = originalContent;
    setModifiedContent(originalContent);
    if (editorRef.current) {
      const modifiedEditor = editorRef.current.getModifiedEditor();
      if (modifiedEditor) {
        modifiedEditor.setValue(originalContent);
      }
    }
    setIsInitializing(false);
    setStatus('已复制本地数据至右侧编辑器，请点击 推送至远端 执行推送。');
  }, [originalContent, modifiedContent, setStatus]);

  // ── Save Local ──

  const handleSaveLocal = useCallback(async () => {
    if (!activeEnv) return;
    const currentContent = editorRef.current
      ? editorRef.current.getOriginalEditor().getValue()
      : originalContent;
    if (!(await validateEditorContent(currentContent, activeEnv.localFilePath, '保存'))) return;
    setIsLoading(true);
    setStatus('正在保存至本地文件...');
    try {
      await writeLocalFile(activeEnv.localFilePath, currentContent, originalEnding);
      committedOriginal.current = currentContent;
      setOriginalContent(currentContent);
      setIsDirty(false);
      setStatus(`🟢 本地保存成功 (${new Date().toLocaleTimeString()})`);
    } catch (err: any) {
      setStatus(`❌ 本地保存异常: ${err.message || err}`);
    } finally {
      setIsLoading(false);
    }
  }, [activeEnv, originalContent, originalEnding, setStatus, validateEditorContent]);

  // ── Push Config ──

  const handlePushConfig = useCallback(async (): Promise<boolean> => {
    if (!activeEnv) return false;
    const currentContent = editorRef.current
      ? editorRef.current.getModifiedEditor().getValue()
      : modifiedContent;
    if (!(await validateEditorContent(currentContent, activeEnv.localFilePath, '推送'))) return false;
    // Check production lock
    if (activeEnv.isProduction && isLocked(activeEnv.id)) {
      setStatus('❌ 推送受阻: 生产环境处于锁定状态，请先在面板解锁。');
      return false;
    }
    // Second confirmation for production (always active regardless of lockEnabled)
    if (activeEnv.isProduction) {
      const statsText =
        diffStats.added > 0 || diffStats.removed > 0
          ? `\n\n变更摘要:\n  + ${diffStats.added} 行新增\n  - ${diffStats.removed} 行删除`
          : '\n\n变更摘要: 无实际内容变更';
      const doubleCheck = await confirm(
        `您当前正向生产环境进行物理覆写，操作将实时生效。${statsText}\n\n目标: ${activeEnv.sshConfig.username}@${activeEnv.sshConfig.host}:${activeEnv.sshConfig.port}\n文件: ${getRemoteFilePath(activeEnv)}\n\n是否确定提交？`,
        { title: '⚠️ 生产环境安全二次验证', kind: 'warning' }
      );
      if (!doubleCheck) return false;
    }
    setIsLoading(true);
    setStatus('正在执行配置覆写推送...');
    try {
      const backup = await invoke<BackupRecord | null>('push_remote_config', {
        envId: activeEnv.id,
        host: activeEnv.sshConfig.host,
        port: activeEnv.sshConfig.port,
        username: activeEnv.sshConfig.username,
        privateKeyPath:
          activeEnv.sshConfig.authType === 'key'
            ? activeEnv.sshConfig.privateKeyPath
            : null,
        remoteFilePath: getRemoteFilePath(activeEnv),
        content: currentContent,
        originalEnding,
        backupEnabled: activeEnv.backupEnabled && !isInitializing,
      });
      committedModified.current = currentContent;
      setModifiedContent(currentContent);
      setIsDirty(false);
      if (isViewingBackup) {
        setIsViewingBackup(false);
      }
      const backupNote = backup ? ` 🕐已备份` : '';
      setStatus(`🟢 推送成功${backupNote} (${new Date().toLocaleTimeString()})`);
      if (activeEnv.isProduction) {
        resetLock(activeEnv.id);
      }
      return true;
    } catch (err: unknown) {
      const errObj = parseAppError(err);
      setStatus(`❌ 远端覆写异常: ${errObj.message}`);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [activeEnv, modifiedContent, originalEnding, isInitializing, isViewingBackup, diffStats, isLocked, resetLock, setStatus, validateEditorContent]);

  // ── Editor Mount ──

  const handleDiffEditorMount = useCallback((diffEditor: editor.IStandaloneDiffEditor) => {
    // Dispose previous editor subscriptions to prevent leaks
    if (editorRef.current) {
      const prevSubs = (editorRef.current as EditorWithSubs)[SUB_KEY];
      if (prevSubs) prevSubs.forEach((s: IDisposable) => s.dispose());
    }
    editorRef.current = diffEditor;

    const originalEditor = diffEditor.getOriginalEditor();
    const origSub = originalEditor.onDidChangeModelContent(() => {
      const current = originalEditor.getValue();
      if (trimTrailingNL(current) !== trimTrailingNL(committedOriginal.current)) {
        committedOriginal.current = current;
        setOriginalContent(current);
        setIsDirty(true);
      }
    });

    const modifiedEditor = diffEditor.getModifiedEditor();
    const modSub = modifiedEditor.onDidChangeModelContent(() => {
      const current = modifiedEditor.getValue();
      if (trimTrailingNL(current) !== trimTrailingNL(committedModified.current)) {
        committedModified.current = current;
        setModifiedContent(current);
        setIsDirty(true);
      }
    });

    diffEditor.onDidUpdateDiff(() => {
      const changes = diffEditor.getLineChanges() || [];
      let added = 0;
      let removed = 0;
      for (const change of changes) {
        added += change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1;
        removed += change.originalEndLineNumber - change.originalStartLineNumber + 1;
      }
      setDiffStats({ added, removed });
    });

    (diffEditor as EditorWithSubs)[SUB_KEY] = [origSub, modSub];
  }, []);

  const getEditorLanguage = useCallback(() => {
    return activeEnv ? getLanguageByPath(activeEnv.localFilePath) : 'plaintext';
  }, [activeEnv]);

  return {
    activeEnv,
    originalContent,
    modifiedContent,
    originalEnding,
    isDirty,
    isLoading,
    isInitializing,
    diffStats,
    pendingSwitchEnv,
    backupRecords,
    showBackupRestore,
    backupContent,
    isViewingBackup,
    editorRef,
    getEditorLanguage,
    handleSaveLocal,
    handlePushConfig,
    handleEnvironmentSwitch,
    handleOneKeyInitialize,
    handleDiffEditorMount,
    setPendingSwitchEnv,
    handleSaveAndSwitch,
    handleDiscardAndSwitch,
    handleCancelSwitch,
    loadBackupList,
    handleLoadBackupForDiff,
    handleSwitchToRemote,
    handleRestoreBackup,
    handleDeleteBackup,
    toggleBackupPanel,
    resetActiveEnv,
  };
}
