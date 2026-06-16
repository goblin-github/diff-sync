import React, { useState } from 'react';
import { Project, Environment, getRemoteFilePath } from '../types';

interface Props {
  projects: Project[];
  activeEnvId: string | null;
  onAddProject: () => void;
  onRenameProject: (project: Project) => void;
  onDeleteProject: (projectId: string) => void;
  onAddEnvironment: () => void;
  onEditEnvironment: (env: Environment) => void;
  onCloneEnvironment: (env: Environment) => void;
  onDeleteEnvironment: (envId: string, projectId: string) => void;
  onSelectEnvironment: (env: Environment) => void;
}

export const ProjectsView: React.FC<Props> = ({
  projects,
  activeEnvId,
  onAddProject,
  onRenameProject,
  onDeleteProject,
  onAddEnvironment,
  onEditEnvironment,
  onCloneEnvironment,
  onDeleteEnvironment,
  onSelectEnvironment,
}) => {
  // Track selected project in this view (independent of global activeProjectId)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => projects[0]?.id ?? null,
  );

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden select-none">
      {/* ── Left: Project list ── */}
      <div className="w-52 min-w-[180px] border-r border-zinc-800 bg-zinc-950/60 flex flex-col shrink-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 shrink-0">
          <span className="text-[12px] font-semibold text-zinc-500 uppercase tracking-wider">项目</span>
          <span className="text-[13px] text-zinc-600">{projects.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 py-1">
          {projects.map((project) => {
            const isSelected = project.id === selectedProjectId;
            const envCount = project.environments.length;
            return (
              <div
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                className={`group flex items-center gap-2 px-3 py-2 mx-1 rounded cursor-pointer transition ${
                  isSelected
                    ? 'bg-emerald-500/10 border border-emerald-500/20'
                    : 'hover:bg-zinc-800/40 border border-transparent'
                }`}
              >
                {/* Icon */}
                <span className="text-sm shrink-0">{isSelected ? '📂' : '📁'}</span>
                {/* Name */}
                <span
                  className={`text-sm truncate flex-1 min-w-0 font-medium ${
                    isSelected ? 'text-emerald-400' : 'text-zinc-300'
                  }`}
                >
                  {project.name}
                </span>
                {/* Env count */}
                <span className="text-[13px] text-zinc-600 tabular-nums shrink-0">{envCount}</span>
                {/* Actions — visible on hover */}
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 ml-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRenameProject(project);
                    }}
                    className="text-zinc-500 hover:text-zinc-200 text-[12px] cursor-pointer"
                    title="重命名"
                  >
                    ✎
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteProject(project.id);
                    }}
                    className="text-zinc-500 hover:text-red-400 text-[12px] cursor-pointer"
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="p-2 border-t border-zinc-800 shrink-0">
          <button
            onClick={onAddProject}
            className="w-full py-1.5 rounded text-[13px] text-zinc-400 border border-dashed border-zinc-700 hover:border-zinc-500 hover:text-zinc-200 transition cursor-pointer"
          >
            + 新建项目
          </button>
        </div>
      </div>

      {/* ── Right: Environment cards ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider">
              {selectedProject ? `「${selectedProject.name}」环境` : '环境'}
            </span>
            {selectedProject && (
              <span className="text-[13px] text-zinc-600 tabular-nums">
                {selectedProject.environments.length}
              </span>
            )}
          </div>
          {selectedProject && (
            <button
              onClick={onAddEnvironment}
              className="text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 px-2 py-1 rounded transition cursor-pointer"
            >
              + 添加环境
            </button>
          )}
        </div>

        {/* Environment cards */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          {!selectedProject ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <span className="text-4xl mb-3">📂</span>
              <p className="text-sm text-zinc-500">选择左侧项目查看环境</p>
            </div>
          ) : selectedProject.environments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <span className="text-4xl mb-3">🔌</span>
              <p className="text-sm text-zinc-500 mb-3">此项目暂无环境</p>
              <button
                onClick={onAddEnvironment}
                className="px-4 py-1.5 rounded text-[13px] text-zinc-400 border border-dashed border-zinc-700 hover:border-zinc-500 hover:text-zinc-200 transition cursor-pointer"
              >
                + 添加第一个环境
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 max-w-2xl">
              {selectedProject.environments.map((env) => (
                <div
                  key={env.id}
                  className={`group rounded-lg border transition cursor-pointer ${
                    env.id === activeEnvId
                      ? 'bg-emerald-500/5 border-emerald-500/30'
                      : 'bg-zinc-950/80 border-zinc-800 hover:border-zinc-700'
                  }`}
                  onClick={() => {
                    onSelectEnvironment(env);
                  }}
                >
                  {/* Card header */}
                  <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-zinc-800/60">
                    {/* Status dot */}
                    <span
                      className={`shrink-0 w-2 h-2 rounded-full ${
                        env.isProduction ? 'bg-red-500' : 'bg-emerald-500'
                      }`}
                      title={env.isProduction ? '生产环境' : '开发环境'}
                    />
                    {/* Name + badge */}
                    <span
                      className={`text-base font-semibold flex-1 min-w-0 truncate ${
                        env.id === activeEnvId ? 'text-emerald-400' : 'text-zinc-200'
                      }`}
                    >
                      {env.name}
                    </span>
                    <span
                      className={`text-[13px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${
                        env.isProduction
                          ? 'bg-red-950/50 text-red-400 border border-red-500/30'
                          : 'bg-emerald-950/50 text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      {env.isProduction ? '生产' : '开发'}
                    </span>
                    {/* Action buttons — visible on hover */}
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 ml-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditEnvironment(env);
                        }}
                        className="px-1.5 py-0.5 rounded text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition cursor-pointer"
                        title="编辑"
                      >
                        编辑
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloneEnvironment(env);
                        }}
                        className="px-1.5 py-0.5 rounded text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition cursor-pointer"
                        title="克隆"
                      >
                        克隆
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteEnvironment(env.id, selectedProject.id);
                        }}
                        className="px-1.5 py-0.5 rounded text-[12px] text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                        title="删除"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  {/* Card body — connection details */}
                  <div className="px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="text-zinc-600 shrink-0 w-10 text-right">SSH</span>
                      <span className="text-zinc-400 font-mono">
                        {env.sshConfig.username}@{env.sshConfig.host}:{env.sshConfig.port}
                      </span>
                      <span className="text-zinc-600">
                        {env.sshConfig.authType === 'key' ? '🔑' : '🔒'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="text-zinc-600 shrink-0 w-10 text-right">本地</span>
                      <span className="text-zinc-500 truncate font-mono" title={env.localFilePath}>
                        {env.localFilePath}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="text-zinc-600 shrink-0 w-10 text-right">远端</span>
                      <span className="text-zinc-500 truncate font-mono" title={getRemoteFilePath(env)}>
                        {getRemoteFilePath(env)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {/* Add environment card */}
              <button
                onClick={onAddEnvironment}
                className="rounded-lg border border-dashed border-zinc-700 hover:border-zinc-500 py-6 text-center text-zinc-500 hover:text-zinc-300 transition cursor-pointer max-w-2xl"
              >
                <span className="text-lg">+</span>
                <p className="text-[12px]">添加环境</p>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectsView;
