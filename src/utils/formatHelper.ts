export function normalizeLineEndings(content: string): string {
  if (!content) return '';
  return content.replace(/\r\n/g, '\n');
}

export function getLanguageByPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const mapping: Record<string, string> = {
    yaml: 'yaml', yml: 'yaml',
    json: 'json',
    ini: 'ini', conf: 'ini',
    xml: 'xml',
    toml: 'toml',
    properties: 'ini',
  };
  return mapping[ext] || 'plaintext';
}

/** Parse Rust AppError from invoke catch, extracting code + message */
export interface ParsedError {
  code: number;
  message: string;
}

export function parseAppError(err: unknown): ParsedError {
  if (typeof err === 'string') {
    try {
      const parsed = JSON.parse(err);
      return { code: parsed.code || 0, message: parsed.message || err };
    } catch {
      return { code: 0, message: err };
    }
  }
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return { code: (e.code as number) || 0, message: (e.message as string) || String(err) };
  }
  return { code: 0, message: String(err) };
}
