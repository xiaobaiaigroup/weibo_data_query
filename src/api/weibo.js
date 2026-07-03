import { getApiBaseUrl } from './base.js';

export async function batchQueryWeibo(urls) {
  const response = await fetch(`${getApiBaseUrl()}/api/weibo/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ urls })
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || '批量查询失败');
  }

  return payload;
}
