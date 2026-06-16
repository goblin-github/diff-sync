import React, { useState, useCallback } from 'react';
import { Project, Environment } from '../types';

interface Props {
  projects: Project[];
  activeProjectId: string | null;
  activeEnvId: string | null;
  onSelectProject: (id: string | null) => void;
  onSelectEnvironment: (env: Environment) => void;
}

export const ProjectTree: React.FC<Props> = ({
  projects,
  activeProjectId,
  activeEnvId,
  onSelectEnvironment,
}) => {
  // Track expanded projects; default expand the one with active env
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    if (activeProjectId) return new Set([activeProjectId]);
    return new Set(projects.slice(0, 3).map((p) => p.id));
  });

  const toggleExpand = useCallback((projectId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  if (projects.length === 0) {
    return (
      <aside className="w-52 min-w-[180px] max-w-[260px] border-r border-zinc-800 bg-zinc-950 flex shrink-0 overflow-hidden select-none">
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
          <span className="text-zinc-700 text-3xl mb-2">📁</span>
          <p className="text-[12px] text-zinc-500 leading-relaxed">
            暂无项目
          </p>
          <p className="text-[13px] text-zinc-600 mt-1">
            点击左侧 📁 创建项目
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-52 min-w-[180px] max-w-[260px] border-r border-zinc-800 bg-zinc-950 flex shrink-0 overflow-hidden select-none">
      <div className="flex flex-col h-full flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center px-3 py-2.5 border-b border-zinc-800 shrink-0">
          <span className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider">
            项目树
          </span>
          <span className="ml-auto text-[13px] text-zinc-600 tabular-nums">
            {projects.length}项目
          </span>
        </div>

        {/* Tree content */}
        <div className="flex-1 overflow-y-auto min-h-0 py-1">
          {projects.map((project) => {
            const isExpanded = expandedIds.has(project.id);
            const envCount = project.environments.length;

            return (
              <div key={project.id} className="select-none">
                {/* Project row */}
                <div
                  onClick={() => toggleExpand(project.id)}
                  className="flex items-center gap-1.5 px-2 py-1.5 mx-1 rounded hover:bg-zinc-800/40 cursor-pointer transition group"
                >
                  {/* Expand/collapse chevron */}
                  <span
                    className={`text-[12px] text-zinc-600 group-hover:text-zinc-400 transition-transform duration-150 shrink-0 ${
                      isExpanded ? 'rotate-90' : ''
                    }`}
                  >
                    ▶
                  </span>
                  {/* Folder icon */}
                  <span className="text-sm shrink-0">
                    {isExpanded ? '📂' : '📁'}
                  </span>
                  {/* Project name */}
                  <span className="text-sm text-zinc-300 truncate flex-1 min-w-0 font-medium">
                    {project.name}
                  </span>
                  {/* Env count badge */}
                  <span className="text-[13px] text-zinc-600 tabular-nums shrink-0">
                    {envCount}
                  </span>
                </div>

                {/* Environment children */}
                {isExpanded && (
                  <div className="ml-2">
                    {envCount === 0 ? (
                      <p className="text-[13px] text-zinc-600 pl-8 py-1.5">
                        暂无环境
                      </p>
                    ) : (
                      project.environments.map((env) => (
                        <div
                          key={env.id}
                          onClick={() => onSelectEnvironment(env)}
                          className={`flex items-center gap-2 pl-7 pr-2 py-1.5 mx-1 rounded cursor-pointer transition group ${
                            env.id === activeEnvId
                              ? 'bg-emerald-500/10 border border-emerald-500/20'
                              : 'hover:bg-zinc-800/40 border border-transparent'
                          }`}
                        >
                          {/* Status dot */}
                          <span
                            className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                              env.isProduction ? 'bg-red-500' : 'bg-emerald-500'
                            }`}
                            title={env.isProduction ? '生产环境' : '开发环境'}
                          />
                          {/* Env name */}
                          <span
                            className={`text-[13px] truncate flex-1 min-w-0 ${
                              env.id === activeEnvId
                                ? 'text-emerald-400 font-semibold'
                                : 'text-zinc-400 group-hover:text-zinc-200'
                            }`}
                          >
                            {env.name}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-zinc-800 shrink-0">
          <p className="text-[13px] text-zinc-600 text-center tabular-nums">
            {projects.reduce((acc, p) => acc + p.environments.length, 0)} 个环境
          </p>
        </div>
      </div>
    </aside>
  );
};

export default ProjectTree;
