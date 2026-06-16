import React, { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { confirm } from '@tauri-apps/plugin-dialog';
import { DiffEditor } from '@monaco-editor/react';
import { Project, Environment, getRemoteFilePath } from './types';

import { getLanguageByPath } from './utils/formatHelper';
import ProjectList from './components/ProjectList';
import EnvironmentModal from './components/EnvironmentModal';
import ProjectModal from './components/ProjectModal';
import StatusBar from './components/StatusBar';
import SettingsModal from './components/SettingsModal';
import { useToast } from './components/Toast';
import { useAppData } from './hooks/useAppData';
import { useProductionLock } from './hooks/useProductionLock';
import { useEditorSession } from './hooks/useEditorSession';

export const App: React.FC = () => {
  const { toast } = useToast();

  // ── Backup editor ref ──
  const backupEditorRef = useRef<any>(null);

  // ── Status & Toast ──
  const [statusText, setStatusText] = useState('工具初始化完毕');
  const [statusType, setStatusType] = useState<'info' | 'success' | 'error' | 'warning'>('info');
  const setStatus = useCallback(
    (msg: string) => {
      setStatusText(msg);
      if (msg.startsWith('❌')) {
        setStatusType('error');
        toast(msg.replace(/^❌\s*/, ''), 'error');
      } else if (msg.startsWith('🟢')) {
        setStatusType('success');
        toast(msg.replace(/^🟢\s*/, ''), 'success');
      } else if (msg.startsWith('⚠️')) {
        setStatusType('warning');
        toast(msg.replace(/^⚠️\s*/, ''), 'warning');
      } else setStatusType('info');
    },
    [toast],
  );

  // ── UI State ──
  const [showProjModal, setShowProjModal] = useState(false);
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingEnv, setEditingEnv] = useState<Environment | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  // ── Data Layer ──
  const {
    projects,
    setProjects,
    activeProjectId,
    setActiveProjectId,
    activeEnvId,
    setActiveEnvId,
    settings,
    setLockEnabled,
    setLockTimeoutMinutes,
    setLocalEditable,
    onOpenSettings,
  } = useAppData();

  const { lockEnabled, lockTimeoutMinutes, localEditable } = settings;

  // ── Production Lock ──
  const {
    unlockedEnvIds,
    autoLockRemaining,
    isLocked,
    toggleUnlock,
    resetLock,
  } = useProductionLock(lockEnabled, lockTimeoutMinutes, setStatus);

  // ── Editor Session ──
  const editor = useEditorSession({
    setProjects,
    activeProjectId,
    activeEnvId,
    setActiveEnvId,
    lockEnabled,
    localEditable,
    isLocked,
    resetLock,
    setStatus,
  });

  // ── Backup restore with current editor content ──
  const handleBackupRestore = useCallback(async () => {
    const content = backupEditorRef.current
      ? backupEditorRef.current.getModifiedEditor().getValue()
      : undefined;
    await editor.handleRestoreBackup(content);
  }, [editor]);

  // ── macOS menu bar → Preferences ──
  useEffect(() => {
    return onOpenSettings(() => setShowSettings(true));
  }, [onOpenSettings]);

  // ── SSH pool status logging ──
  useEffect(() => {
    const unlisten = listen<{ reused: boolean; cacheKey: string; message: string }>(
      'ssh-pool-status',
      (event) => {
        const { reused, cacheKey, message } = event.payload;
        console.log(
          `%c${message} %c[${cacheKey}]`,
          reused
            ? 'color: #10b981; font-weight: bold'
            : 'color: #f59e0b; font-weight: bold',
          'color: #6b7280; font-size: 0.85em',
        );
      },
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // ── Environment CRUD ──

  const deleteEnvironment = async (envId: string, projectId: string) => {
    const ok = await confirm('确定要删除此环境吗？相关凭据也将被清除。', {
      title: '确认删除',
      kind: 'warning',
    });
    if (!ok) return;
    await invoke('delete_env_credential', { envId });
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, environments: p.environments.filter((e) => e.id !== envId) }
          : p,
      ),
    );
    if (activeEnvId === envId) {
      setActiveEnvId(null);
      editor.resetActiveEnv();
    }
  };

  const cloneEnvironment = (env: Environment) => {
    const newEnv = { ...env, id: crypto.randomUUID(), name: `${env.name} (副本)` };
    setProjects((prev) =>
      prev.map((p) =>
        p.id === activeProjectId
          ? { ...p, environments: [...p.environments, newEnv] }
          : p,
      ),
    );
  };

  const handleRenameProject = (projectId: string, newName: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, name: newName } : p)),
    );
    setEditingProject(null);
    setShowProjModal(false);
  };

  const handleDeleteProject = async (projectId: string) => {
    const ok = await confirm('确定要删除此项目及其所有环境吗？相关凭据和备份也将被清除。', {
      title: '确认删除项目',
      kind: 'warning',
    });
    if (!ok) return;
    // Delete credentials for all environments in this project
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      for (const env of project.environments) {
        await invoke('delete_env_credential', { envId: env.id });
      }
    }
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      setActiveEnvId(null);
      editor.resetActiveEnv();
    }
  };

  // ── Render ──

  return (
    <div className="relative flex h-screen w-screen flex-col bg-zinc-950 text-zinc-100 overflow-hidden select-none">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4">
        <div className="flex items-center space-x-3">
          <span className="text-sm font-semibold tracking-wide text-zinc-100">
            异同 <span className="text-zinc-500 font-normal text-xs">DiffSync</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(true)}
            className="rounded bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition border border-zinc-700 cursor-pointer"
            title="设置"
          >
            ⚙️
          </button>
          <button
            onClick={() => {
              setEditingProject(null);
              setShowProjModal(true);
            }}
            className="rounded bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-700 transition border border-zinc-700 cursor-pointer"
          >
            + 创建新项目
          </button>
        </div>
      </header>

      {/* Connection Bar */}
      {editor.activeEnv && (
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900/90 px-4 text-[11px]">
          <span
            className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
              editor.activeEnv.isProduction
                ? 'bg-red-950/60 text-red-400 border border-red-500/30'
                : 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
            }`}
          >
            {editor.activeEnv.isProduction ? '🔴' : '🟢'} {editor.activeEnv.name}
          </span>

          <span className="text-zinc-700 select-none">|</span>

          <span className="text-zinc-500 shrink-0">本地</span>
          <span className="text-zinc-300 truncate max-w-[200px]" title={editor.activeEnv.localFilePath}>
            {editor.activeEnv.localFilePath.split('/').pop()}
          </span>

          <span className="text-zinc-700 select-none">|</span>

          <span className="text-zinc-500 shrink-0">远端</span>
          <span className="text-zinc-300 truncate max-w-[180px]" title={`${editor.activeEnv.sshConfig.username}@${editor.activeEnv.sshConfig.host}:${editor.activeEnv.sshConfig.port}`}>
            {editor.activeEnv.sshConfig.username}@{editor.activeEnv.sshConfig.host}:{editor.activeEnv.sshConfig.port}
          </span>
          <span className="text-zinc-500 text-[10px] truncate max-w-[200px]" title={getRemoteFilePath(editor.activeEnv)}>
            {getRemoteFilePath(editor.activeEnv)}
          </span>

          <div className="flex-1 min-w-0" />

          {/* One-key initialize */}
          {editor.isInitializing && (
            <button
              onClick={editor.handleOneKeyInitialize}
              className="shrink-0 px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-semibold hover:bg-amber-500/30 border border-amber-500/30 transition cursor-pointer"
            >
              ⚡ 初始化远程文件
            </button>
          )}

          {/* Production safety lock */}
          {lockEnabled && editor.activeEnv.isProduction && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={`text-[10px] font-semibold ${
                  unlockedEnvIds[editor.activeEnv.id] ? 'text-amber-400' : 'text-red-400'
                }`}
              >
                {unlockedEnvIds[editor.activeEnv.id] ? '🔓' : '🔒'}
              </span>
              {autoLockRemaining !== null && (
                <span className="text-[9px] text-amber-400/80 tabular-nums">
                  {Math.floor(autoLockRemaining / 60)}:{String(autoLockRemaining % 60).padStart(2, '0')}
                </span>
              )}
              <button
                onClick={() => toggleUnlock(editor.activeEnv!.id)}
                className={`px-1.5 py-0.5 rounded text-[10px] border transition cursor-pointer ${
                  unlockedEnvIds[editor.activeEnv.id]
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
                }`}
              >
                {unlockedEnvIds[editor.activeEnv.id] ? '重新锁定' : '解锁写入'}
              </button>
            </div>
          )}

          {/* Backup section */}
          {editor.activeEnv.backupEnabled && (
            <div className="relative shrink-0">
              <button
                onClick={editor.toggleBackupPanel}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition cursor-pointer border ${
                  editor.showBackupRestore
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-zinc-800'
                }`}
              >
                🕐 备份
                {editor.backupRecords.length > 0 && (
                  <span className="text-zinc-500">({editor.backupRecords.length})</span>
                )}
                <span className={`text-[8px] transition-transform duration-200 ${editor.showBackupRestore ? 'rotate-0' : '-rotate-90'}`}>
                  ▼
                </span>
              </button>
              {editor.showBackupRestore && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => editor.toggleBackupPanel()} />
                  <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-lg border border-emerald-900/40 bg-zinc-900 shadow-2xl overflow-hidden">
                    <div className="max-h-56 overflow-y-auto p-2 space-y-1">
                      {editor.backupRecords.length === 0 ? (
                        <p className="text-[10px] text-zinc-500 text-center py-4">暂无备份记录</p>
                      ) : (
                        editor.backupRecords.map((r) => (
                          <div
                            key={r.filename}
                            className="bg-zinc-800/60 rounded px-2 py-1.5 border border-zinc-800/50"
                          >
                            <span
                              className="text-[10px] text-zinc-300 break-all leading-relaxed"
                              title={r.filename}
                            >
                              {r.filename}
                            </span>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-[9px] text-zinc-500">
                                {r.size > 1024 ? `${(r.size / 1024).toFixed(1)}KB` : `${r.size}B`}
                              </span>
                              <div className="flex gap-1">
                                <button
                                  onClick={() => {
                                    editor.handleLoadBackupForDiff(r.filename);
                                  }}
                                  className="text-[10px] text-emerald-400 hover:text-emerald-300 cursor-pointer"
                                >
                                  比对
                                </button>
                                <button
                                  onClick={() => editor.handleDeleteBackup(r.filename)}
                                  className="text-[10px] text-red-400 hover:text-red-300 cursor-pointer"
                                >
                                  删
                                </button>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left Sidebar: Projects */}
        <aside className="w-60 min-w-[200px] max-w-[320px] border-r border-zinc-800 bg-zinc-950 flex shrink-0 overflow-hidden select-none">
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <ProjectList
              projects={projects}
              activeProjectId={activeProjectId}
              activeEnvId={editor.activeEnv?.id ?? null}
              setActiveProjectId={setActiveProjectId}
              onSelectEnvironment={editor.handleEnvironmentSwitch}
              onDeleteEnvironment={deleteEnvironment}
              onCloneEnvironment={cloneEnvironment}
              onEditEnvironment={(env) => {
                setEditingEnv(env);
                setShowEnvModal(true);
              }}
              onAddEnvironment={() => {
                setEditingEnv(null);
                setShowEnvModal(true);
              }}
              onRenameProject={(project) => {
                setEditingProject(project);
                setShowProjModal(true);
              }}
              onDeleteProject={handleDeleteProject}
            />
          </div>
        </aside>

        {/* Right panel: Diff Editor */}
        <main className="flex-1 bg-zinc-900 relative flex flex-col min-w-0 overflow-hidden">
          {editor.activeEnv ? (
            editor.isViewingBackup && editor.backupContent !== null ? (
              /* ── Backup diff: Backup (read-only) ↔ Remote (editable) ── */
              <div className="flex-1 flex flex-col bg-zinc-950 overflow-hidden">
                <div className="flex items-center h-6 shrink-0 text-[11px]">
                  <span className="text-center text-orange-400 font-medium" style={{ width: '50%' }}>
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400 mr-1 align-middle" />
                    备份（只读）
                  </span>
                  <span className="text-center text-red-400" style={{ width: '50%' }}>
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 mr-1 align-middle" />
                    远端（可编辑）
                  </span>
                </div>
                <div className="flex-1 min-h-[120px] overflow-hidden">
                  <DiffEditor
                    key={`${editor.activeEnv.id}-backup`}
                    original={editor.backupContent}
                    modified={editor.modifiedContent}
                    language={editor.getEditorLanguage()}
                    theme="vs-dark"
                    onMount={(diffEditor) => {
                      // Dispose previous ref to prevent leaks on remount
                      if (backupEditorRef.current) {
                        backupEditorRef.current = null;
                      }
                      backupEditorRef.current = diffEditor;
                    }}
                    options={{
                      readOnly: false,
                      originalEditable: false,
                      renderSideBySide: true,
                      enableSplitViewResizing: false,
                      minimap: { enabled: false },
                      scrollbar: { vertical: 'visible' },
                    }}
                  />
                </div>
                <div className="flex items-center justify-center gap-3 shrink-0 py-2">
                  <button
                    onClick={editor.handleSwitchToRemote}
                    className="px-4 py-1 rounded text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-800 transition cursor-pointer"
                  >
                    取消比对
                  </button>
                  <button
                    onClick={handleBackupRestore}
                    disabled={editor.isLoading}
                    className={`px-4 py-1 rounded text-[11px] transition cursor-pointer ${
                      editor.isLoading
                        ? 'text-zinc-600 cursor-not-allowed'
                        : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                    }`}
                  >
                    覆盖远端
                  </button>
                </div>
              </div>
            ) : (
              /* ── Normal diff layout ── */
              <div className="flex-1 flex flex-col bg-zinc-950 overflow-hidden">
                <div className="flex items-center h-6 shrink-0 text-[11px]">
                  <span className="text-center text-emerald-400" style={{ width: '50%' }}>
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 align-middle" />
                    本地
                  </span>
                  <span className="text-center text-red-400" style={{ width: '50%' }}>
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 mr-1 align-middle" />
                    远端
                  </span>
                </div>
                <div className="flex-1 min-h-[120px] overflow-hidden">
                  <DiffEditor
                    original={editor.originalContent}
                    modified={editor.modifiedContent}
                    language={editor.getEditorLanguage()}
                    theme="vs-dark"
                    onMount={editor.handleDiffEditorMount}
                    options={{
                      readOnly: false,
                      originalEditable: localEditable,
                      renderSideBySide: true,
                      enableSplitViewResizing: false,
                      scrollbar: { vertical: 'visible', horizontal: 'visible' },
                    }}
                  />
                </div>
                {/* Button bar — hidden in backup compare mode */}
                {!editor.isViewingBackup && (
                <div className="flex items-center shrink-0 text-[11px]">
                  <div className="flex justify-center py-2 gap-2" style={{ width: '50%' }}>
                    <button
                      onClick={editor.handleSaveLocal}
                      disabled={!localEditable}
                      className={`px-4 py-1 rounded transition cursor-pointer ${
                        localEditable
                          ? 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                          : 'text-zinc-600 cursor-not-allowed'
                      }`}
                      title={localEditable ? '保存至本地' : '本地文件不可编辑，保存功能已禁用（可在设置中启用）'}
                    >
                      保存至本地
                    </button>
                  </div>
                  <div className="flex justify-center py-2" style={{ width: '50%' }}>
                    <button
                      onClick={editor.handlePushConfig}
                      disabled={editor.isLoading}
                      className={`px-4 py-1 rounded transition cursor-pointer ${
                        editor.isLoading
                          ? 'text-zinc-600 cursor-not-allowed'
                          : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                      }`}
                    >
                      推送至远端
                    </button>
                  </div>
                </div>
                )}
              </div>
            )
          ) : projects.length === 0 ? (
            /* ── First-time welcome ── */
            <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950">
              <span className="text-6xl mb-4">🔧</span>
              <h2 className="text-lg font-bold text-zinc-300 mb-2">欢迎使用 DiffSync</h2>
              <p className="text-xs text-zinc-500 leading-relaxed text-center max-w-sm mb-5">
                安全、高效的远程配置同步工具。<br />
                通过 SSH 连接远程服务器，实时比对并同步配置文件。
              </p>
              <button
                onClick={() => {
                  setEditingProject(null);
                  setShowProjModal(true);
                }}
                className="px-5 py-2.5 rounded-lg bg-emerald-500 text-zinc-950 text-sm font-semibold hover:bg-emerald-400 transition cursor-pointer shadow-lg shadow-emerald-500/20"
              >
                + 创建第一个项目
              </button>
              <p className="text-[10px] text-zinc-600 mt-4">
                创建项目后即可添加环境并开始比对配置文件
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950">
              <span className="text-zinc-700 text-5xl mb-3">⚡</span>
              <p className="text-sm text-zinc-500 font-light">请在左侧选择一个环境开始比对</p>
            </div>
          )}
        </main>
      </div>

      {/* Loading overlay */}
      {editor.isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-xs">
          <div className="flex flex-col items-center space-y-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
            <span className="text-xs text-zinc-400">远程操作处理中，请稍候...</span>
          </div>
        </div>
      )}

      {/* Unsaved changes switch confirmation */}
      {editor.pendingSwitchEnv && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/85 backdrop-blur-xs">
          <div className="w-[420px] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl p-6 space-y-5">
            <h3 className="text-sm font-bold text-zinc-100">⚠️ 未保存的修改</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              当前环境 <span className="text-zinc-200 font-medium">{editor.activeEnv?.name}</span> 有未保存的修改。
              切换至 <span className="text-zinc-200 font-medium">{editor.pendingSwitchEnv.name}</span> 前请选择如何处理：
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={editor.handleSaveAndSwitch}
                className="w-full py-2 rounded bg-emerald-500 text-zinc-950 text-xs font-semibold hover:bg-emerald-400 transition cursor-pointer"
              >
                💾 保存修改并切换
              </button>
              <button
                onClick={editor.handleDiscardAndSwitch}
                className="w-full py-2 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-700 transition cursor-pointer"
              >
                🗑 放弃修改并切换
              </button>
              <button
                onClick={editor.handleCancelSwitch}
                className="w-full py-2 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-400 hover:bg-zinc-700 transition cursor-pointer"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status bar */}
      <StatusBar
        statusText={statusText}
        statusType={statusType}
        language={editor.activeEnv ? getLanguageByPath(editor.activeEnv.localFilePath) : '—'}
        ending={editor.originalEnding}
        diffStats={editor.diffStats}
      />

      {/* Modals */}
      {showSettings && (
        <SettingsModal
          lockEnabled={lockEnabled}
          onLockEnabledChange={setLockEnabled}
          lockTimeoutMinutes={lockTimeoutMinutes}
          onLockTimeoutChange={setLockTimeoutMinutes}
          localEditable={localEditable}
          onLocalEditableChange={setLocalEditable}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showProjModal && (
        <ProjectModal
          initialName={editingProject?.name}
          onClose={() => {
            setShowProjModal(false);
            setEditingProject(null);
          }}
          onSave={(name) => {
            if (editingProject) {
              handleRenameProject(editingProject.id, name);
            } else {
              const newProj: Project = {
                id: crypto.randomUUID(),
                name,
                environments: [],
              };
              setProjects((prev) => [...prev, newProj]);
              setActiveProjectId(newProj.id);
              setShowProjModal(false);
            }
          }}
        />
      )}

      {showEnvModal && (
        <EnvironmentModal
          initialEnv={editingEnv}
          onClose={() => {
            setShowEnvModal(false);
            setEditingEnv(null);
          }}
          onSave={async (env, cred) => {
            await invoke('save_env_credential', {
              envId: env.id,
              password: cred.password,
              privateKeyPassphrase: cred.privateKeyPassphrase,
            });
            if (editingEnv) {
              setProjects((prev) =>
                prev.map((p) =>
                  p.id === activeProjectId
                    ? {
                        ...p,
                        environments: p.environments.map((e) =>
                          e.id === env.id ? env : e,
                        ),
                      }
                    : p,
                ),
              );
            } else {
              setProjects((prev) =>
                prev.map((p) =>
                  p.id === activeProjectId
                    ? { ...p, environments: [...p.environments, env] }
                    : p,
                ),
              );
            }
            setShowEnvModal(false);
            setEditingEnv(null);
          }}
        />
      )}
    </div>
  );
};
