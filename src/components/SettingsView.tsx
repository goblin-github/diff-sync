import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  lockEnabled: boolean;
  onLockEnabledChange: (enabled: boolean) => void;
  lockTimeoutMinutes: number;
  onLockTimeoutChange: (minutes: number) => void;
  localEditable: boolean;
  onLocalEditableChange: (editable: boolean) => void;
}

export const SettingsView: React.FC<Props> = ({
  lockEnabled,
  onLockEnabledChange,
  lockTimeoutMinutes,
  onLockTimeoutChange,
  localEditable,
  onLocalEditableChange,
}) => {
  const [configDir, setConfigDir] = useState('加载中...');
  const [timeoutInput, setTimeoutInput] = useState(String(lockTimeoutMinutes));

  useEffect(() => {
    invoke<string>('get_app_config_dir')
      .then(setConfigDir)
      .catch(() => setConfigDir('无法获取路径'));
  }, []);

  // Sync timeout input when prop changes externally
  useEffect(() => {
    setTimeoutInput(String(lockTimeoutMinutes));
  }, [lockTimeoutMinutes]);

  const handleTimeoutCommit = () => {
    const mins = parseInt(timeoutInput, 10);
    if (mins >= 1 && mins <= 60) {
      onLockTimeoutChange(mins);
    } else {
      // Revert to current value if invalid
      setTimeoutInput(String(lockTimeoutMinutes));
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-5">
      {/* Data directory */}
      <div className="space-y-1.5">
        <label className="block text-[12px] font-bold text-zinc-400 uppercase tracking-wide">
          数据存储目录
        </label>
        <code className="block w-full rounded bg-zinc-800 border border-zinc-700 text-[13px] text-zinc-300 px-2.5 py-2 font-mono break-all select-all leading-relaxed">
          {configDir}
        </code>
        <button
          onClick={() => navigator.clipboard.writeText(configDir)}
          className="text-[12px] text-zinc-500 hover:text-zinc-200 cursor-pointer transition"
        >
          📋 复制路径
        </button>
        <p className="text-[13px] text-zinc-600">
          项目、凭据、known_hosts 均存放在此
        </p>
      </div>

      <hr className="border-zinc-800" />

      {/* Production safety lock toggle */}
      <div className="space-y-1.5">
        <label className="block text-[12px] font-bold text-zinc-400 uppercase tracking-wide">
          生产安全保护锁
        </label>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={lockEnabled}
            onChange={(e) => onLockEnabledChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-emerald-500 cursor-pointer"
          />
          <span className="text-sm text-zinc-300">启用生产环境保护锁</span>
        </label>
        <p className="text-[13px] text-zinc-600">
          关闭后跳过解锁步骤，二次确认弹窗依然保留
        </p>
      </div>

      <hr className="border-zinc-800" />

      {/* Auto-lock timeout */}
      <div className={`space-y-1.5 ${!lockEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
        <label className="block text-[12px] font-bold text-zinc-400 uppercase tracking-wide">
          自动回锁（分钟）
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={timeoutInput}
            onChange={(e) => setTimeoutInput(e.target.value)}
            onBlur={handleTimeoutCommit}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTimeoutCommit(); }}
            min={1}
            max={60}
            disabled={!lockEnabled}
            className="w-20 rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 transition disabled:opacity-50"
          />
          <span className="text-[12px] text-zinc-500">1-60 分钟</span>
        </div>
        <p className="text-[13px] text-zinc-600">
          解锁后超过此时间无操作自动回锁
        </p>
      </div>

      <hr className="border-zinc-800" />

      {/* Local file editable toggle */}
      <div className="space-y-1.5">
        <label className="block text-[12px] font-bold text-zinc-400 uppercase tracking-wide">
          编辑器行为
        </label>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={localEditable}
            onChange={(e) => onLocalEditableChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-emerald-500 cursor-pointer"
          />
          <span className="text-sm text-zinc-300">允许编辑本地文件</span>
        </label>
        <p className="text-[13px] text-zinc-600">
          开启后可修改 diff 编辑器本地端内容
        </p>
      </div>
    </div>
  );
};

export default SettingsView;
