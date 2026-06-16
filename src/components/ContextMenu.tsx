import React, { useEffect, useRef } from 'react';

interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<Props> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('scroll', handler, { capture: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('scroll', handler, { capture: true });
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 180);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 32 - 8);

  return (
    <div
      ref={ref}
      className="fixed z-[200] min-w-[150px] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl py-1 animate-fade-in select-none"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={(e) => {
            e.stopPropagation();
            item.onClick();
            onClose();
          }}
          disabled={item.disabled}
          className={`w-full text-left px-3 py-1.5 text-sm transition cursor-pointer ${
            item.disabled
              ? 'text-zinc-600 cursor-not-allowed'
              : item.danger
                ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
                : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};

export default ContextMenu;
