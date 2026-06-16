import React, { useState } from 'react';

interface Props {
  onClose: () => void;
  onSave: (name: string) => void;
  /** If provided, the modal is in "edit" mode with pre-filled name. */
  initialName?: string;
}

export const ProjectModal: React.FC<Props> = ({ onClose, onSave, initialName }) => {
  const [name, setName] = useState(initialName || '');
  const isEdit = initialName !== undefined;

  const handleSave = () => {
    if (!name.trim()) return;
    onSave(name.trim());
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-950/80 backdrop-blur-xs animate-fade-in"
      onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) handleSave(); }}
    >
      <div className="w-96 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl p-6 space-y-4">
        <h3 className="text-base font-bold text-zinc-100">
          {isEdit ? '重命名项目' : '创建新项目'}
        </h3>
        <div className="space-y-2">
          <label className="block text-[12px] font-bold text-zinc-400 uppercase tracking-wide">
            项目名称
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如: 游戏服务A"
            className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-3 py-2 focus:outline-none focus:border-emerald-500 transition"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className={`px-4 py-1.5 rounded text-sm font-semibold transition cursor-pointer ${
              name.trim()
                ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
                : 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed'
            }`}
          >
            {isEdit ? '保存' : '创建项目'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectModal;
