import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CONFIG_DIR = path.resolve(__dirname, '..', '..');
const CONFIG_FILE_NAME = 'config.json';
const DEFAULT_CONFIG = { WEIBO_COOKIE: '' };

let configDirectory = DEFAULT_CONFIG_DIR;

export const MISSING_COOKIE_MESSAGE = '未配置微博 Cookie，请点击右上角“Cookie 设置”填写后再查询。';

export function setConfigDirectory(directory) {
  if (directory) {
    configDirectory = directory;
  }
}

export function getConfigPath() {
  return path.join(configDirectory, CONFIG_FILE_NAME);
}

export function ensureConfigFile() {
  fs.mkdirSync(configDirectory, { recursive: true });

  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    writeConfig(DEFAULT_CONFIG);
  }

  return configPath;
}

export function readConfig() {
  const configPath = ensureConfigFile();
  const raw = fs.readFileSync(configPath, 'utf8');

  if (!raw.trim()) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config.json 内容必须是 JSON 对象');
    }

    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      WEIBO_COOKIE: typeof parsed.WEIBO_COOKIE === 'string' ? parsed.WEIBO_COOKIE : ''
    };
  } catch (error) {
    throw new Error('config.json 格式错误，请检查或清空后重新保存 Cookie。');
  }
}

export function writeConfig(config) {
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.writeFileSync(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function getStoredWeiboCookie() {
  return readConfig().WEIBO_COOKIE.trim();
}

export function getEffectiveWeiboCookie() {
  const storedCookie = getStoredWeiboCookie();
  if (storedCookie) {
    return storedCookie;
  }

  return String(process.env.WEIBO_COOKIE || '').trim();
}

export function getConfigStatus() {
  const cookie = getEffectiveWeiboCookie();

  return {
    hasCookie: Boolean(cookie),
    maskedCookie: cookie ? maskCookie(cookie) : ''
  };
}

export function saveWeiboCookie(cookie) {
  const cleanedCookie = String(cookie || '').trim();

  if (!cleanedCookie) {
    throw new Error('Cookie 不能为空');
  }

  writeConfig({ ...readConfig(), WEIBO_COOKIE: cleanedCookie });

  return {
    success: true,
    message: 'Cookie 已保存'
  };
}

export function clearWeiboCookie() {
  writeConfig({ ...readConfig(), WEIBO_COOKIE: '' });

  return {
    success: true,
    message: 'Cookie 已清空'
  };
}

export function maskCookie(cookie) {
  return String(cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => {
      const [name, ...valueParts] = part.split('=');
      const value = valueParts.join('=');

      if (!value) {
        return `${name}=****`;
      }

      return `${name}=${value.slice(0, 4)}****`;
    })
    .join('; ');
}
