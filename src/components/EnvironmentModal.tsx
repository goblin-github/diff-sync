import React, { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Environment, getFileBaseName } from '../types';
import { selectLocalConfigFile, selectPrivateKeyFile } from '../services/tauriDialog';
import { parseAppError } from '../utils/formatHelper';

interface Props {
  initialEnv: Environment | null;
  lockEnabled: boolean;
  onClose: () => void;
  onSave: (env: Environment, cred: { password?: string; privateKeyPassphrase?: string }) => void;
}

export const EnvironmentModal: React.FC<Props> = ({ initialEnv, lockEnabled, onClose, onSave }) => {
  const isEditing = !!initialEnv;

  const [name, setName] = useState(initialEnv?.name || '');
  const [isProduction, setIsProduction] = useState(initialEnv?.isProduction || false);
  const [backupEnabled, setBackupEnabled] = useState(initialEnv?.backupEnabled || false);
  const [localFilePath, setLocalFilePath] = useState(initialEnv?.localFilePath || '');
  const [remoteFolderPath, setRemoteFolderPath] = useState(
    initialEnv?.remoteFolderPath || ''
  );
  const [remoteFileName, setRemoteFileName] = useState(
    initialEnv?.remoteFileName || (initialEnv ? getFileBaseName(initialEnv.localFilePath) : '')
  );
  const [host, setHost] = useState(initialEnv?.sshConfig.host || '');
  const [port, setPort] = useState(initialEnv?.sshConfig.port || 22);
  const [username, setUsername] = useState(initialEnv?.sshConfig.username || '');
  const [authType, setAuthType] = useState<'key' | 'password'>(
    initialEnv?.sshConfig.authType || 'password'
  );
  const [privateKeyPath, setPrivateKeyPath] = useState(
    initialEnv?.sshConfig.privateKeyPath || ''
  );
  const [password, setPassword] = useState('');
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const envId = initialEnv?.id || crypto.randomUUID();

  // Load saved credentials when editing
  useEffect(() => {
    if (!isEditing) return;
    (async () => {
      try {
        const cred = await invoke<{ password?: string; private_key_passphrase?: string }>(
          'get_env_credential',
          { envId }
        );
        if (cred?.password) setPassword(cred.password);
        if (cred?.private_key_passphrase) setPrivateKeyPassphrase(cred.private_key_passphrase);
      } catch {}
    })();
  }, []);

  // Auto-fill remote file name when localFilePath changes and remoteFileName is empty
  useEffect(() => {
    if (!localFilePath) return;
    if (!remoteFileName) {
      setRemoteFileName(getFileBaseName(localFilePath));
    }
  }, [localFilePath]);

  const fullRemotePath = useMemo(() => {
    const folder = remoteFolderPath.replace(/\/+$/, '');
    const file = remoteFileName.replace(/^\/+/, '');
    return folder && file ? `${folder}/${file}` : folder || file;
  }, [remoteFolderPath, remoteFileName]);

  const handleBrowseLocal = async () => {
    const path = await selectLocalConfigFile();
    if (path) {
      setLocalFilePath(path);
      // Auto-fill remote file name from local if empty
      if (!remoteFileName) setRemoteFileName(getFileBaseName(path));
    }
  };

  const handleBrowseKey = async () => {
    const path = await selectPrivateKeyFile();
    if (path) setPrivateKeyPath(path);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await invoke<string>('test_ssh_connection', {
        host,
        port,
        username,
        privateKeyPath: authType === 'key' ? privateKeyPath : null,
        password: authType === 'password' ? password : null,
        privateKeyPassphrase: privateKeyPassphrase || null,
      });
      setTestResult(`✅ ${result}`);
    } catch (err: unknown) {
      const parsed = parseAppError(err);
      setTestResult(`❌ ${parsed.message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!name.trim() || !localFilePath.trim() || !host.trim() || !remoteFolderPath.trim() || !remoteFileName.trim()) return;

    const env: Environment = {
      id: envId,
      name: name.trim(),
      isProduction,
      backupEnabled,
      localFilePath: localFilePath.trim(),
      remoteFolderPath: remoteFolderPath.trim(),
      remoteFileName: remoteFileName.trim(),
      sshConfig: {
        host: host.trim(),
        port,
        username: username.trim(),
        authType,
        privateKeyPath: authType === 'key' ? privateKeyPath.trim() : undefined,
      },
    };

    onSave(env, {
      password: password || undefined,
      privateKeyPassphrase: privateKeyPassphrase || undefined,
    });
  };

  const isValid = name.trim() && localFilePath.trim() && host.trim() && remoteFolderPath.trim() && remoteFileName.trim();

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-950/80 backdrop-blur-xs animate-fade-in"
      onKeyDown={(e) => { if (e.key === 'Enter' && isValid && !testing) handleSave(); }}
    >
      <div className="w-[560px] max-h-[88vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl p-6 space-y-5">
        <h3 className="text-base font-bold text-zinc-100">
          {isEditing ? '编辑环境' : '添加新环境'}
        </h3>

        {/* Environment name + type */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="block text-[12px] font-bold text-zinc-400 uppercase tracking-wide">
              环境名称 *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: 预发环境、灰度B组"
              className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[12px] font-bold text-zinc-400 uppercase tracking-wide">
              环境标识 *
            </label>
            <select
              value={isProduction ? 'production' : 'development'}
              onChange={(e) => setIsProduction(e.target.value === 'production')}
              className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 transition cursor-pointer"
            >
              <option value="development">🟢 开发环境</option>
              <option value="production">🔴 生产环境{lockEnabled ? '（安全锁已开启）' : '（安全锁已关闭）'}</option>
            </select>
          </div>
        </div>

        <hr className="border-zinc-800" />

        {/* Local file */}
        <div className="space-y-1.5">
          <label className="block text-[12px] font-bold text-zinc-400 uppercase tracking-wide">
            本地配置文件路径 *
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={localFilePath}
              onChange={(e) => setLocalFilePath(e.target.value)}
              placeholder="例如: /etc/app/config.json"
              className="flex-1 rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 transition"
            />
            <button
              onClick={handleBrowseLocal}
              className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-700 transition cursor-pointer shrink-0"
            >
              浏览
            </button>
          </div>
        </div>

        {/* Remote file: folder + filename */}
        <div className="space-y-3">
          <h4 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wide">
            远程文件配置 *
          </h4>
          <div className="space-y-1.5">
            <label className="block text-[12px] text-zinc-500">远程文件夹路径</label>
            <input
              type="text"
              value={remoteFolderPath}
              onChange={(e) => setRemoteFolderPath(e.target.value)}
              placeholder="例如: /etc/app"
              className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 transition"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[12px] text-zinc-500">远程配置文件名</label>
            <input
              type="text"
              value={remoteFileName}
              onChange={(e) => setRemoteFileName(e.target.value)}
              placeholder="默认同本地文件名"
              className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 transition"
            />
          </div>
          <p className="text-[12px] text-zinc-600">
            完整路径: <span className="text-zinc-400 font-mono">{fullRemotePath || '(未填写)'}</span>
          </p>
        </div>

        {/* Backup config */}
        <div className="space-y-3 bg-zinc-800/30 rounded-lg p-3 border border-zinc-800">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[13px] text-zinc-300 font-medium">🕐 云端备份</span>
              <p className="text-[12px] text-zinc-500 mt-0.5">每次推送前自动备份远端文件到本地</p>
            </div>
            <button
              type="button"
              onClick={() => setBackupEnabled(!backupEnabled)}
              className={`relative w-10 h-5 rounded-full transition cursor-pointer ${
                backupEnabled ? 'bg-emerald-500' : 'bg-zinc-600'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition ${
                  backupEnabled ? 'left-5' : 'left-0.5'
                }`}
              />
            </button>
          </div>

          {backupEnabled && (
            <div className="space-y-1.5 pt-1 border-t border-zinc-700/50">
              <p className="text-[12px] text-zinc-600">
                备份文件名: <span className="text-zinc-400 font-mono">{remoteFileName || 'config'}.{'<timestamp>'}.bak</span>
              </p>
              <p className="text-[13px] text-zinc-500">保留最近 5 份备份，时间戳格式: YYYYMMDD_HHMMSS</p>
            </div>
          )}
        </div>

        <hr className="border-zinc-800" />

        {/* SSH connection */}
        <div className="space-y-3">
          <h4 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wide">
            SSH 远程连接
          </h4>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1.5">
              <label className="block text-[12px] text-zinc-500">主机地址 *</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="例如: 192.168.1.100"
                className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 transition"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[12px] text-zinc-500">端口</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 transition"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-[12px] text-zinc-500">用户名 *</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="例如: root"
              className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 transition"
            />
          </div>

          {/* Auth type */}
          <div className="space-y-1.5">
            <label className="block text-[12px] text-zinc-500">认证方式</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm text-zinc-300 cursor-pointer">
                <input
                  type="radio"
                  name="authType"
                  checked={authType === 'password'}
                  onChange={() => setAuthType('password')}
                  className="accent-emerald-500"
                />
                密码
              </label>
              <label className="flex items-center gap-1.5 text-sm text-zinc-300 cursor-pointer">
                <input
                  type="radio"
                  name="authType"
                  checked={authType === 'key'}
                  onChange={() => setAuthType('key')}
                  className="accent-emerald-500"
                />
                私钥文件
              </label>
            </div>
          </div>

          {authType === 'key' && (
            <>
              <div className="space-y-1.5">
                <label className="block text-[12px] text-zinc-500">SSH 私钥路径</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={privateKeyPath}
                    onChange={(e) => setPrivateKeyPath(e.target.value)}
                    placeholder="例如: ~/.ssh/id_rsa"
                    className="flex-1 rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-2.5 py-1.5 focus:outline-none focus:border-emerald-500 transition"
                  />
                  <button
                    onClick={handleBrowseKey}
                    className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-700 transition cursor-pointer shrink-0"
                  >
                    浏览
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-[12px] text-zinc-500">私钥密码（如有）</label>
                <div className="relative">
                  <input
                    type={showPassphrase ? 'text' : 'password'}
                    value={privateKeyPassphrase}
                    onChange={(e) => setPrivateKeyPassphrase(e.target.value)}
                    placeholder="私钥加密密码"
                    className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-2.5 py-1.5 pr-8 focus:outline-none focus:border-emerald-500 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-sm text-zinc-500 hover:text-zinc-300 cursor-pointer select-none"
                    tabIndex={-1}
                  >
                    {showPassphrase ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
            </>
          )}

          {authType === 'password' && (
            <div className="space-y-1.5">
              <label className="block text-[12px] text-zinc-500">SSH 密码</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="输入 SSH 登录密码"
                  className="w-full rounded bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 px-2.5 py-1.5 pr-8 focus:outline-none focus:border-emerald-500 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-sm text-zinc-500 hover:text-zinc-300 cursor-pointer select-none"
                  tabIndex={-1}
                >
                  {showPassword ? '🙈' : '👁'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Test connection */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleTestConnection}
            disabled={testing || !host.trim()}
            className={`px-3 py-1.5 rounded text-sm transition cursor-pointer ${
              testing || !host.trim()
                ? 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed'
                : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            {testing ? '测试中...' : '🔌 测试连接'}
          </button>
          {testResult && <span className="text-sm text-zinc-400">{testResult}</span>}
        </div>

        <hr className="border-zinc-800" />

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded text-sm text-zinc-400 hover:text-zinc-200 bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid}
            className={`px-4 py-1.5 rounded text-sm font-semibold transition cursor-pointer ${
              isValid
                ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
                : 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed'
            }`}
          >
            {isEditing ? '保存修改' : '添加环境'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EnvironmentModal;
