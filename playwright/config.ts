import path from 'path';

export interface PlaywrightConfig {
  baseUrl: string;
  flowUrl: string;
  defaultProjectId: string;
  userDataDir: string;
  storageStatePath: string;
  defaultTimeout: number;
  viewport: { width: number; height: number };
}

const PROJECT_ROOT = path.resolve(__dirname, '..');

export const config: PlaywrightConfig = {
  baseUrl: process.env.GOOGLE_LABS_URL || 'https://flow.google.com',
  flowUrl: process.env.GOOGLE_FLOW_URL || 'https://flow.google.com',
  defaultProjectId: process.env.GOOGLE_FLOW_PROJECT_ID || '',
  userDataDir: path.join(PROJECT_ROOT, 'playwright', 'user_data', 'user_1'),
  storageStatePath: path.join(PROJECT_ROOT, 'playwright', 'storage', 'state.json'),
  defaultTimeout: 120000, // 120 seconds
  viewport: { width: 1440, height: 900 },
};

export const getStorageStatePath = () => config.storageStatePath;
export const getUserDataDir = () => config.userDataDir;
