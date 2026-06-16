import React from 'react';

interface Props {
  language: string;
  ending: string;
  diffStats: { added: number; removed: number };
}

export const EditorInfoBar: React.FC<Props> = ({ language, ending, diffStats }) => {
  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-950 px-4 text-[12px] text-zinc-500 select-none">
      <div className="flex items-center gap-3">
        <span>语言: {language.toUpperCase()}</span>
        <span>换行: {ending}</span>
      </div>
      <div>
        {(diffStats.added > 0 || diffStats.removed > 0) && (
          <span>
            <span className="text-emerald-400">+{diffStats.added}</span>
            {' '}
            <span className="text-red-400">-{diffStats.removed}</span>
          </span>
        )}
      </div>
    </div>
  );
};

export default EditorInfoBar;
