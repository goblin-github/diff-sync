import React from 'react';
import { Project, Environment } from '../types';
import ProjectList from './ProjectList';
import BackupsView from './BackupsView';
import SettingsView from './SettingsView';

type NavType = 'projects' | 'backups' | 'settings';

interface Props {
  activeNav: NavType;
  onClose: () => void;
  // Projects nav props
  projects: Project[];
  activeProjectId: string | null;
  activeEnvId: string | null;
  onSelectProject: (id: string | null) => void;
  onSelectEnvironment: (env: Environment) => void;
  onCloseActiveEnv: () => void;
  onAddEnvironment: () => void;
  onEditEnvironment: (env: Environment) => void;
  onCloneEnvironment: (env: Environment) => void;
  onDeleteEnvironment: (envId: string, projectId: string) => void;
  onRenameProject: (project: Project) => void;
  onDeleteProject: (projectId: string) => void;
  onAddProject: () => void;
  // Settings nav props
  lockEnabled: boolean;
  onLockEnabledChange: (v: boolean) => void;
  lockTimeoutMinutes: number;
  onLockTimeoutChange: (v: number) => void;
  localEditable: boolean;
  onLocalEditableChange: (v: boolean) => void;
}

const NAV_TITLES: Record<NavType, string> = {
  projects: '项目',
  backups: '备份',
  settings: '设置',
};

export const ContextPanel: React.FC<Props> = (props) => {
  const { activeNav } = props;

  const renderContent = () => {
    switch (activeNav) {
      case 'projects':
        return (
          <ProjectList
            projects={props.projects}
            activeProjectId={props.activeProjectId}
            activeEnvId={props.activeEnvId}
            setActiveProjectId={props.onSelectProject}
            onSelectEnvironment={props.onSelectEnvironment}
            onCloseActiveEnv={props.onCloseActiveEnv}
            onDeleteEnvironment={props.onDeleteEnvironment}
            onCloneEnvironment={props.onCloneEnvironment}
            onEditEnvironment={props.onEditEnvironment}
            onAddEnvironment={props.onAddEnvironment}
            onRenameProject={props.onRenameProject}
            onDeleteProject={props.onDeleteProject}
          />
        );
      case 'backups':
        return <BackupsView projects={props.projects} />;
      case 'settings':
        return (
          <div className="flex flex-col h-full overflow-hidden">
            <SettingsView
              lockEnabled={props.lockEnabled}
              onLockEnabledChange={props.onLockEnabledChange}
              lockTimeoutMinutes={props.lockTimeoutMinutes}
              onLockTimeoutChange={props.onLockTimeoutChange}
              localEditable={props.localEditable}
              onLocalEditableChange={props.onLocalEditableChange}
            />
          </div>
        );
    }
  };

  return (
    <aside className="w-60 min-w-[200px] max-w-[320px] border-r border-zinc-800 bg-zinc-950 flex shrink-0 overflow-hidden select-none">
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* Panel header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 shrink-0">
          <span className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider">
            {NAV_TITLES[activeNav]}
          </span>
          <div className="flex items-center gap-1">
            {activeNav === 'projects' && (
              <button
                onClick={props.onAddProject}
                className="text-zinc-500 hover:text-zinc-200 text-sm cursor-pointer transition"
                title="新建项目"
              >
                +
              </button>
            )}
            <button
              onClick={props.onClose}
              className="text-zinc-500 hover:text-zinc-200 text-sm cursor-pointer transition ml-0.5"
              title="关闭面板"
            >
              ✕
            </button>
          </div>
        </div>
        {/* Panel content */}
        {renderContent()}
      </div>
    </aside>
  );
};

export default ContextPanel;
