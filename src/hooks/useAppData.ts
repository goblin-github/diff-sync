import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { message } from '@tauri-apps/plugin-dialog';
import { AppStorage, Project, migrateEnvironment } from '../types';

export interface AppSettingsState {
  lockEnabled: boolean;
  lockTimeoutMinutes: number;
  localEditable: boolean;
}

export interface UseAppDataReturn {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  activeProjectId: string | null;
  setActiveProjectId: React.Dispatch<React.SetStateAction<string | null>>;
  activeEnvId: string | null;
  setActiveEnvId: React.Dispatch<React.SetStateAction<string | null>>;
  settings: AppSettingsState;
  setLockEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setLockTimeoutMinutes: React.Dispatch<React.SetStateAction<number>>;
  setLocalEditable: React.Dispatch<React.SetStateAction<boolean>>;
  dataLoadedRef: React.MutableRefObject<boolean>;
  onOpenSettings: (handler: () => void) => () => void;
}

const DEFAULT_LOCK_TIMEOUT = 5;

export function useAppData(): UseAppDataReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(null);
  const [lockEnabled, setLockEnabled] = useState(true);
  const [lockTimeoutMinutes, setLockTimeoutMinutes] = useState(DEFAULT_LOCK_TIMEOUT);
  const [localEditable, setLocalEditable] = useState(false);
  const dataLoadedRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsHandlersRef = useRef<Array<() => void>>([]);

  // Load persisted data from Rust file storage
  useEffect(() => {
    // Listen for macOS menu bar → Preferences
    const unlisten = listen('open-settings', () => {
      settingsHandlersRef.current.forEach((h) => h());
    });

    const loadData = async () => {
      try {
        const raw = await invoke<string>('load_projects');
        if (raw) {
          const parsed: AppStorage = JSON.parse(raw);
          // Migrate old environment format (remoteFilePath → remoteFolderPath + remoteFileName)
          const migrated = (parsed.projects || []).map((p: Project) => ({
            ...p,
            environments: p.environments.map((e: any) => migrateEnvironment(e)),
          }));
          setProjects(migrated);
          setActiveProjectId(parsed.activeProjectId || null);
          setActiveEnvId(parsed.activeEnvId || null);
          if (parsed.settings?.lockTimeoutMinutes) {
            setLockTimeoutMinutes(parsed.settings.lockTimeoutMinutes);
          }
          if (parsed.settings?.lockEnabled !== undefined) {
            setLockEnabled(parsed.settings.lockEnabled);
          }
          if (parsed.settings?.localEditable !== undefined) {
            setLocalEditable(parsed.settings.localEditable);
          }
        }
      } catch (err) {
        console.error('[DiffSync] 加载本地元数据异常:', err);
      }
      dataLoadedRef.current = true;
      // Disclaimer (keep in localStorage — non-critical)
      const showDisclaimer = async () => {
        const hasShown = localStorage.getItem('diff_sync_disclaimer_shown');
        if (hasShown) return;
        // Set flag immediately to prevent double-show in StrictMode
        localStorage.setItem('diff_sync_disclaimer_shown', 'true');
        try {
          await message(
            '欢迎使用 DiffSync（异同）配置同步工具。\n\n注意事项：\n1. 直连同步，覆盖前请进行链路及格式确认。\n2. 单文件大小建议控制在 5MB 以内。\n3. 请确保对远程目标目录具备写入权限。',
            { title: '安全与性能指引', kind: 'info' }
          );
        } catch (_) {
          // flag already set above
        }
      };
      showDisclaimer();
    };
    loadData();
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Persist data to Rust file storage on change (debounced 500ms)
  useEffect(() => {
    if (!dataLoadedRef.current) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const data: AppStorage = {
        version: 1,
        projects,
        activeProjectId,
        activeEnvId,
        settings: { lockTimeoutMinutes, lockEnabled, localEditable },
      };
      invoke('save_projects', { data: JSON.stringify(data) }).catch(() => {});
    }, 500);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [projects, activeProjectId, activeEnvId, lockTimeoutMinutes, lockEnabled, localEditable]);

  const onOpenSettings = useCallback((handler: () => void) => {
    settingsHandlersRef.current.push(handler);
    return () => {
      settingsHandlersRef.current = settingsHandlersRef.current.filter((h) => h !== handler);
    };
  }, []);

  return {
    projects,
    setProjects,
    activeProjectId,
    setActiveProjectId,
    activeEnvId,
    setActiveEnvId,
    settings: { lockEnabled, lockTimeoutMinutes, localEditable },
    setLockEnabled,
    setLockTimeoutMinutes,
    setLocalEditable,
    dataLoadedRef,
    onOpenSettings,
  };
}
