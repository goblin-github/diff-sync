import React, { useState } from 'react';
import { Project, Environment } from '../types';
import ContextMenu from './ContextMenu';

interface Props {
  projects: Project[];
  activeProjectId: string | null;
  activeEnvId: string | null;
  setActiveProjectId: (id: string | null) => void;
  onSelectEnvironment: (env: Environment) => void;
  onDeleteEnvironment: (envId: string, projectId: string) => void;
  onCloneEnvironment: (env: Environment) => void;
  onEditEnvironment: (env: Environment) => void;
  onAddEnvironment: () => void;
  onRenameProject: (project: Project) => void;
  onDeleteProject: (projectId: string) => void;
  onCloseActiveEnv?: () => void;
}

export const ProjectList: React.FC<Props> = ({
  projects,
  activeProjectId,
  activeEnvId,
  setActiveProjectId,
  onSelectEnvironment,
  onDeleteEnvironment,
  onCloneEnvironment,
  onEditEnvironment,
  onAddEnvironment,
  onRenameProject,
  onDeleteProject,
  onCloseActiveEnv,
}) => {
  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; env: Environment;
  } | null>(null);

  return (
    <div className="flex flex-col h-full overflow-hidden select-none">
      {/* Project selector */}
      <div className="p-3 border-b border-zinc-800">
        <div className="flex items-center gap-1">
          <select
            className="flex-1 min-w-0 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 px-2 py-1.5 focus:outline-none focus:border-emerald-500 transition cursor-pointer"
            value={activeProjectId || ''}
            onChange={(e) => setActiveProjectId(e.target.value || null)}
          >
            <option value="" className="text-zinc-500">选择项目...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {activeProjectId && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => {
                  const proj = projects.find((p) => p.id === activeProjectId);
                  if (proj) onRenameProject(proj);
                }}
                className="text-zinc-500 hover:text-zinc-200 text-[12px] px-1 py-0.5 cursor-pointer"
                title="重命名项目"
              >
                ✎
              </button>
              <button
                onClick={() => onDeleteProject(activeProjectId)}
                className="text-zinc-500 hover:text-red-400 text-[12px] px-1 py-0.5 cursor-pointer"
                title="删除项目"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Environment list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeProject ? (
          <div className="p-2 space-y-1">
            <div className="flex items-center justify-end px-2 py-0.5">
              <button
                onClick={onAddEnvironment}
                className="text-zinc-500 hover:text-zinc-200 text-sm cursor-pointer transition"
                title="添加环境"
              >
                + 添加
              </button>
            </div>
            {activeProject.environments.length === 0 ? (
              <p className="text-[12px] text-zinc-600 text-center py-4">
                暂无环境，点击 + 添加
              </p>
            ) : (
              activeProject.environments.map((env) => (
                <div
                  key={env.id}
                  className={`group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800/50 cursor-pointer transition ${
                    env.id === activeEnvId
                      ? 'bg-zinc-800/80 ring-1 ring-emerald-500/30'
                      : ''
                  }`}
                  onClick={() => {
                    // Click: open if not already active
                    if (env.id !== activeEnvId) {
                      onSelectEnvironment(env);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ x: e.clientX, y: e.clientY, env });
                  }}
                >
                  <span
                    className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                      env.isProduction ? 'bg-red-500' : 'bg-emerald-500'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${
                      env.id === activeEnvId ? 'text-emerald-400 font-medium' : 'text-zinc-300'
                    }`}>{env.name}</p>
                  </div>
                  {/* Context menu buttons — show on hover */}
                  <div className="hidden group-hover:flex items-center gap-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditEnvironment(env);
                      }}
                      className="text-zinc-500 hover:text-zinc-200 text-[12px] px-1 cursor-pointer"
                      title="编辑"
                    >
                      ✎
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloneEnvironment(env);
                      }}
                      className="text-zinc-500 hover:text-zinc-200 text-[12px] px-1 cursor-pointer"
                      title="克隆"
                    >
                      ⧉
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteEnvironment(env.id, activeProject.id);
                      }}
                      className="text-zinc-500 hover:text-red-400 text-[12px] px-1 cursor-pointer"
                      title="删除"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-4">
            <span className="text-zinc-700 text-2xl mb-2">📂</span>
            <p className="text-[12px] text-zinc-600 text-center">
              {projects.length === 0
                ? '点击右上角 + 创建第一个项目'
                : '选择一个项目查看环境'}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-zinc-800">
        <p className="text-[13px] text-zinc-600 text-center">
          {projects.length} 项目 ·{' '}
          {projects.reduce((acc, p) => acc + p.environments.length, 0)} 环境
        </p>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              label: ctxMenu.env.id === activeEnvId ? '关闭' : '打开',
              onClick: () => {
                if (ctxMenu.env.id === activeEnvId && onCloseActiveEnv) {
                  onCloseActiveEnv();
                } else if (ctxMenu.env.id !== activeEnvId) {
                  onSelectEnvironment(ctxMenu.env);
                }
              },
            },
            {
              label: '编辑',
              onClick: () => onEditEnvironment(ctxMenu.env),
            },
            {
              label: '克隆',
              onClick: () => onCloneEnvironment(ctxMenu.env),
            },
            {
              label: '删除',
              onClick: () => onDeleteEnvironment(ctxMenu.env.id, activeProject!.id),
              danger: true,
            },
          ]}
        />
      )}
    </div>
  );
};

export default ProjectList;
