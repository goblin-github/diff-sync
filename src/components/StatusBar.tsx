import React from 'react';

interface Props {
  statusText: string;
  statusType: 'info' | 'success' | 'error' | 'warning';
  language: string;
  ending: string;
  diffStats: { added: number; removed: number };
}

const TYPE_STYLES: Record<Props['statusType'], { text: string; dot: string }> = {
  error:   { text: 'text-red-300',   dot: 'bg-red-400' },
  success: { text: 'text-emerald-300', dot: 'bg-emerald-400' },
  warning: { text: 'text-amber-300',  dot: 'bg-amber-400' },
  info:    { text: 'text-zinc-400',   dot: 'bg-zinc-500' },
};

export const StatusBar: React.FC<Props> = ({ statusText, statusType, language, ending, diffStats }) => {
  const s = TYPE_STYLES[statusType];

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-950 px-4 text-[10px]">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
        <span className={`truncate ${s.text}`}>
          {statusText}
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-4 text-zinc-500">
        <span>语言: {language.toUpperCase()}</span>
        <span>换行: {ending}</span>
        {(diffStats.added > 0 || diffStats.removed > 0) && (
          <span>
            <span className="text-emerald-400">+{diffStats.added}</span>
            {' '}
            <span className="text-red-400">-{diffStats.removed}</span>
          </span>
        )}
      </div>
    </footer>
  );
};

export default StatusBar;
