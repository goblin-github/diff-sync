import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
import { Project, BackupRecord } from '../types';

interface Props {
  projects: Project[];
}

interface Entry {
  projectName: string;
  envName: string;
  envId: string;
  isProduction: boolean;
  backup: BackupRecord;
}

/** Parse "name.YYYYMMDD_HHMMSS.bak" into display parts */
function parseBackupFilename(filename: string): {
  baseName: string;
  displayTime: string;
} | null {
  // Match: <name>.YYYYMMDD_HHMMSS.bak
  const match = filename.match(/^(.+)\.(\d{8})_(\d{6})\.bak$/);
  if (!match) return null;
  const [, baseName, datePart, timePart] = match;
  const y = datePart.slice(0, 4);
  const m = datePart.slice(4, 6);
  const d = datePart.slice(6, 8);
  const hh = timePart.slice(0, 2);
  const mm = timePart.slice(2, 4);
  const ss = timePart.slice(4, 6);
  return {
    baseName,
    displayTime: `${y}-${m}-${d} ${hh}:${mm}:${ss}`,
  };
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export const BackupsView: React.FC<Props> = ({ projects }) => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const all: Entry[] = [];
      for (const proj of projects) {
        for (const env of proj.environments) {
          if (cancelled) return;
          try {
            const records = await invoke<BackupRecord[]>('list_backups', {
              envId: env.id,
            });
            for (const r of records) {
              all.push({
                projectName: proj.name,
                envName: env.name,
                envId: env.id,
                isProduction: env.isProduction,
                backup: r,
              });
            }
          } catch (_) {
            // skip errors for individual envs
          }
        }
      }
      if (!cancelled) {
        all.sort((a, b) => b.backup.timestamp.localeCompare(a.backup.timestamp));
        setEntries(all);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [projects]);

  const handleDelete = async (entry: Entry) => {
    const ok = await confirm(
      `确定删除备份 ${entry.backup.filename}？`,
      { title: '删除备份', kind: 'warning' },
    );
    if (!ok) return;
    try {
      await invoke('delete_backup', {
        envId: entry.envId,
        backupFilename: entry.backup.filename,
      });
      setEntries((prev) =>
        prev.filter((e) => e.backup.filename !== entry.backup.filename),
      );
    } catch (_) {
      // silently ignore
    }
  };

  // Group by project → env
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        projectName: string;
        envName: string;
        envId: string;
        isProduction: boolean;
        backups: BackupRecord[];
      }
    >();
    for (const e of entries) {
      const key = `${e.projectName}::${e.envId}`;
      if (!map.has(key)) {
        map.set(key, {
          projectName: e.projectName,
          envName: e.envName,
          envId: e.envId,
          isProduction: e.isProduction,
          backups: [],
        });
      }
      map.get(key)!.backups.push(e.backup);
    }
    return Array.from(map.values());
  }, [entries]);

  // Stats
  const totalBackups = entries.length;
  const totalEnvs = groups.length;
  const totalSize = entries.reduce((acc, e) => acc + e.backup.size, 0);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <span className="text-[12px] text-zinc-500">正在加载备份列表...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-zinc-900 min-w-0">
      {/* Header with stats */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 shrink-0 bg-zinc-950/50">
        <span className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider">
          备份管理
        </span>
        {entries.length > 0 && (
          <div className="flex items-center gap-3 text-[13px] text-zinc-600 tabular-nums">
            <span>{totalBackups} 个备份</span>
            <span className="text-zinc-700">·</span>
            <span>{totalEnvs} 个环境</span>
            <span className="text-zinc-700">·</span>
            <span>{formatSize(totalSize)}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="text-5xl mb-4 opacity-40">🕐</span>
            <h3 className="text-base font-medium text-zinc-500 mb-1">暂无备份记录</h3>
            <p className="text-[12px] text-zinc-600 max-w-xs leading-relaxed">
              在环境配置中开启云端备份后，每次推送远端前会自动生成备份文件
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {groups.map((g) => (
              <div
                key={`${g.projectName}::${g.envId}`}
                className="rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden"
              >
                {/* Group header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/80 border-b border-zinc-800/60">
                  {/* Production/Dev dot */}
                  <span
                    className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                      g.isProduction ? 'bg-red-500' : 'bg-emerald-500'
                    }`}
                    title={g.isProduction ? '生产环境' : '开发环境'}
                  />
                  {/* Project / Env breadcrumb */}
                  <span className="text-[13px] text-zinc-400 font-medium truncate">
                    {g.projectName}
                  </span>
                  <span className="text-zinc-700 text-[12px]">/</span>
                  <span className="text-[13px] text-zinc-300 truncate">{g.envName}</span>
                  {/* Badge */}
                  <span
                    className={`shrink-0 text-[13px] px-1.5 py-0.5 rounded font-semibold ${
                      g.isProduction
                        ? 'bg-red-950/50 text-red-400'
                        : 'bg-emerald-950/50 text-emerald-400'
                    }`}
                  >
                    {g.isProduction ? '生产' : '开发'}
                  </span>
                  {/* Count */}
                  <span className="ml-auto text-[13px] text-zinc-600 tabular-nums shrink-0">
                    {g.backups.length} 份备份
                  </span>
                </div>

                {/* Backup entries */}
                <div className="divide-y divide-zinc-800/40">
                  {g.backups.map((b) => {
                    const parsed = parseBackupFilename(b.filename);
                    return (
                      <div
                        key={b.filename}
                        className="flex items-center gap-3 px-3 py-2 group hover:bg-zinc-800/30 transition"
                      >
                        {/* File icon */}
                        <span className="text-sm shrink-0 opacity-50">📄</span>
                        {/* File info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-zinc-300 truncate font-mono">
                            {parsed?.baseName ?? b.filename}
                          </p>
                          <p className="text-[13px] text-zinc-600 mt-0.5">
                            {parsed?.displayTime ?? b.timestamp}
                          </p>
                        </div>
                        {/* Size */}
                        <span className="text-[13px] text-zinc-500 tabular-nums shrink-0">
                          {formatSize(b.size)}
                        </span>
                        {/* Delete */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete({
                              projectName: g.projectName,
                              envName: g.envName,
                              envId: g.envId,
                              isProduction: g.isProduction,
                              backup: b,
                            });
                          }}
                          className="text-[12px] text-zinc-600 hover:text-red-400 cursor-pointer opacity-0 group-hover:opacity-100 transition shrink-0 px-0.5"
                          title="删除此备份"
                        >
                          🗑
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {entries.length > 0 && (
        <div className="px-4 py-2 border-t border-zinc-800 shrink-0 bg-zinc-950/30">
          <p className="text-[13px] text-zinc-600 text-center">
            备份文件存储在本地数据目录，最近 5 份自动轮转
          </p>
        </div>
      )}
    </div>
  );
};

export default BackupsView;
