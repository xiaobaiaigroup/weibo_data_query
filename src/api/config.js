import { getApiBaseUrl } from './base.js';

export async function getConfigStatus() {
  const response = await fetch(`${getApiBaseUrl()}/api/config/status`);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error || '读取 Cookie 配置失败');
  }

  return payload;
}

export async function saveCookie(cookie) {
  const response = await fetch(`${getApiBaseUrl()}/api/config/cookie`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ cookie })
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || 'Cookie 保存失败');
  }

  return payload;
}

export async function clearCookie() {
  const response = await fetch(`${getApiBaseUrl()}/api/config/cookie`, {
    method: 'DELETE'
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || 'Cookie 清空失败');
  }

  return payload;
}
