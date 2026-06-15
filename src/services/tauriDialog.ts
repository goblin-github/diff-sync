import { open } from '@tauri-apps/plugin-dialog';

export async function selectLocalConfigFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: 'Configuration Files',
        extensions: ['yaml', 'yml', 'json', 'ini', 'conf', 'properties', 'xml', 'toml', 'txt']
      }
    ]
  });
  return Array.isArray(selected) ? selected[0] : selected;
}

export async function selectPrivateKeyFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: '请选择所需的 SSH 安全私钥',
    filters: [{ name: 'SSH Private Key', extensions: ['pem', 'key', '*'] }]
  });
  return Array.isArray(selected) ? selected[0] : selected;
}
