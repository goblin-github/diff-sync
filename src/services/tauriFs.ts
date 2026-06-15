import { invoke } from '@tauri-apps/api/core';

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

export async function readLocalFile(filePath: string): Promise<string> {
  try {
    return await invoke<string>('read_local_file', {
      filePath: normalizePath(filePath),
    });
  } catch (error: any) {
    const msg = typeof error === 'string' ? error : error?.message || String(error);
    throw new Error(`本地读取异常: ${msg}`);
  }
}

export async function writeLocalFile(
  filePath: string,
  content: string,
  originalEnding: 'LF' | 'CRLF',
): Promise<void> {
  try {
    await invoke('write_local_file', {
      filePath: normalizePath(filePath),
      content,
      originalEnding,
    });
  } catch (error: any) {
    throw new Error(`本地写入异常: ${error.message || error}`);
  }
}
