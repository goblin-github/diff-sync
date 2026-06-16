import React from 'react';

export type NavType = 'projects' | 'backups' | 'settings';

interface Props {
  activeNav: NavType | null;
  onNavChange: (nav: NavType | null) => void;
}

interface NavItem {
  key: NavType;
  icon: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { key: 'projects', icon: '📁', label: '项目' },
  { key: 'backups', icon: '🕐', label: '备份' },
  { key: 'settings', icon: '⚙️', label: '设置' },
];

export const IconSidebar: React.FC<Props> = ({ activeNav, onNavChange }) => {
  return (
    <nav className="flex flex-col items-center w-11 min-w-[44px] h-full bg-zinc-950 border-r border-zinc-800 py-3 gap-1 select-none">
      {ITEMS.map((item) => {
        const isActive = activeNav === item.key;
        return (
          <button
            key={item.key}
            onClick={() => onNavChange(isActive ? null : item.key)}
            title={isActive ? `关闭${item.label}` : item.label}
            className={`w-9 h-9 flex items-center justify-center rounded text-base transition cursor-pointer ${
              isActive
                ? 'bg-zinc-800 ring-1 ring-emerald-500/30'
                : 'hover:bg-zinc-800/50 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {item.icon}
          </button>
        );
      })}
    </nav>
  );
};

export default IconSidebar;
