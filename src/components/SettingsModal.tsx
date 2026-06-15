import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  lockEnabled: boolean;
  onLockEnabledChange: (enabled: boolean) => void;
  lockTimeoutMinutes: number;
  onLockTimeoutChange: (minutes: number) => void;
  localEditable: boolean;
  onLocalEditableChange: (editable: boolean) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<Props> = ({
  lockEnabled,
  onLockEnabledChange,
  lockTimeoutMinutes,
  onLockTimeoutChange,
  localEditable,
  onLocalEditableChange,
  onClose,
}) => {
  const [configDir, setConfigDir] = useState('加载中...');
  const [timeoutInput, setTimeoutInput] = useState(String(lockTimeoutMinutes));
  const [localLockEnabled, setLocalLockEnabled] = useState(lockEnabled);
  const [localEditableVal, setLocalEditableVal] = useState(localEditable);

  useEffect(() => {
    invoke<string>('get_app_config_dir')
      .then(setConfigDir)
      .catch(() => setConfigDir('无法获取路径'));
  }, []);

  const handleSave = () => {
    const mins = parseInt(timeoutInput, 10);
    if (mins >= 1 && mins <= 60) {
      onLockTimeoutChange(mins);
    }
    onLockEnabledChange(localLockEnabled);
    onLocalEditableChange(localEditableVal);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-950/80 backdrop-blur-xs animate-fade-in">
      <div className="w-[440px] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl p-6 space-y-5">
        <h3 className="text-sm font-bold text-zinc-100">⚙️ 设置</h3>

        {/* Data directory */}
        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wide">
            数据存储目录
          </label>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 px-2.5 py-2 font-mono break-all select-all">
              {configDir}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(configDir)}
              className="px-2.5 py-2 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition cursor-pointer shrink-0"
              title="复制路径"
            >
              📋
            </button>
          </div>
          <p className="text-[10px] text-zinc-600">
            项目数据、凭据、known_hosts 均存放在此目录
          </p>
        </div>

        <hr className="border-zinc-800" />

        {/* Production safety lock toggle */}
        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wide">
            生产安全保护锁
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={localLockEnabled}
              onChange={(e) => setLocalLockEnabled(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-emerald-500 cursor-pointer"
            />
            <span className="text-xs text-zinc-300">启用生产环境保护锁</span>
          </label>
          <p className="text-[10px] text-zinc-600">
            关闭后跳过解锁步骤，但二次确认弹窗依然保留
          </p>
        </div>

        <hr className="border-zinc-800" />

        {/* Auto-lock timeout */}
        <div className={`space-y-1.5 ${!localLockEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
          <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wide">
            生产环境自动回锁时间（分钟）
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={timeoutInput}
              onChange={(e) => setTimeoutInput(e.target.value)}
              min={1}
              max={60}
              disabled={!localLockEnabled}
              className="w-24 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 transition disabled:opacity-50"
            />
            <span className="text-xs text-zinc-500">分钟（1-60）</span>
          </div>
          <p className="text-[10px] text-zinc-600">
            解锁生产环境后，超过此时间无操作将自动回锁
          </p>
        </div>

        <hr className="border-zinc-800" />

        {/* Local file editable toggle */}
        <div className="space-y-1.5">
          <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wide">
            编辑器行为
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={localEditableVal}
              onChange={(e) => setLocalEditableVal(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-emerald-500 cursor-pointer"
            />
            <span className="text-xs text-zinc-300">允许编辑本地文件</span>
          </label>
          <p className="text-[10px] text-zinc-600">
            开启后可在 diff 编辑器中直接修改本地端内容，默认只读
          </p>
        </div>

        <hr className="border-zinc-800" />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!timeoutInput || parseInt(timeoutInput, 10) < 1}
            className="px-4 py-1.5 rounded text-xs font-semibold bg-emerald-500 text-zinc-950 hover:bg-emerald-400 transition cursor-pointer"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
