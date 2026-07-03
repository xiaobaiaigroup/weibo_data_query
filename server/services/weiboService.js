import {
  getEffectiveWeiboCookie,
  MISSING_COOKIE_MESSAGE
} from './configService.js';

const WEIBO_WEB_HOST = 'https://weibo.com';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_CONCURRENCY = 2;
const MAX_RETRY = 1;
const REQUEST_DELAY_MIN_MS = 500;
const REQUEST_DELAY_MAX_MS = 1000;

export function parseWeiboUrl(url) {
  const inputUrl = String(url || '').trim();

  if (!inputUrl) {
    throw new Error('微博链接为空');
  }

  let parsed;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new Error('链接格式错误');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== 'weibo.com' && hostname !== 'www.weibo.com') {
    throw new Error('仅支持 weibo.com 链接');
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('微博链接格式错误，应为 https://weibo.com/{uid}/{mid}');
  }

  const [uid, postId] = parts;
  if (!/^\d+$/.test(uid)) {
    throw new Error('微博链接中的 uid 格式错误');
  }

  if (!/^[A-Za-z0-9]+$/.test(postId)) {
    throw new Error('微博链接中的微博 ID 格式错误');
  }

  return {
    inputUrl,
    uid,
    postId,
    publishUrl: `${WEIBO_WEB_HOST}/${uid}/${postId}`
  };
}

export async function fetchWeiboInfo(url, options = {}) {
  let parsed;

  try {
    parsed = parseWeiboUrl(url);
    if (!getEffectiveWeiboCookie()) {
      throw new Error(MISSING_COOKIE_MESSAGE);
    }

    const data = await fetchStatusData(parsed);
    const authorUid = getAuthorUid(data, parsed.uid);
    const apiFollowers = extractFollowersCount(data, '', parsed.publishUrl, { logMissing: false });
    const html = apiFollowers === '未获取'
      ? await fetchWeiboDetailHtml(parsed)
      : '';
    const followers = await getFollowersCount({
      mblog: data,
      html,
      uid: authorUid,
      cache: options.followersCache,
      sourceUrl: parsed.publishUrl
    });
    const normalized = normalizeStatusData(data, parsed, followers);

    return {
      success: true,
      inputUrl: parsed.inputUrl,
      publishTime: normalized.publishTime,
      content: normalized.content,
      accountName: normalized.accountName,
      publishUrl: normalized.publishUrl,
      comments: normalized.comments,
      likes: normalized.likes,
      reposts: normalized.reposts,
      followers: normalized.followers
    };
  } catch (error) {
    const inputUrl = parsed?.inputUrl || String(url || '').trim();
    return makeFailure(inputUrl, error?.message || '获取微博信息失败', parsed?.publishUrl || inputUrl);
  }
}

export async function batchFetchWeiboInfo(urls) {
  const results = new Array(urls.length);
  const followersCache = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const currentIndex = cursor;
      cursor += 1;
      await randomDelay(REQUEST_DELAY_MIN_MS, REQUEST_DELAY_MAX_MS);
      results[currentIndex] = await fetchWeiboInfoWithRetry(urls[currentIndex], MAX_RETRY, { followersCache });
    }
  }

  const workerCount = Math.min(MAX_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

export async function fetchWeiboInfoWithRetry(url, maxRetry = 1, options = {}) {
  let result;

  for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
    if (attempt > 0) {
      await randomDelay(REQUEST_DELAY_MIN_MS, REQUEST_DELAY_MAX_MS);
    }

    result = await fetchWeiboInfo(url, options);

    if (result.success || !shouldRetry(result)) {
      return result;
    }
  }

  return result;
}

async function fetchStatusData(parsed) {
  const candidates = [
    {
      name: 'weibo_web_ajax',
      url: `https://weibo.com/ajax/statuses/show?id=${encodeURIComponent(parsed.postId)}`
    },
    {
      name: 'weibo_mobile_api',
      url: `https://m.weibo.cn/statuses/show?id=${encodeURIComponent(parsed.postId)}`
    }
  ];

  const errors = [];

  for (const candidate of candidates) {
    try {
      const json = await requestJson(candidate.url, parsed.publishUrl);
      const data = extractStatusPayload(json);

      if (data) {
        return data;
      }

      errors.push(`${candidate.name}: 接口返回结构异常`);
    } catch (error) {
      errors.push(`${candidate.name}: ${error.message}`);
    }
  }

  const loginRelated = errors.some((message) => /登录|权限|403|401|cookie/i.test(message));
  if (loginRelated) {
    throw new Error('需要配置 WEIBO_COOKIE，或该微博不可公开访问');
  }

  throw new Error(errors.at(-1)?.replace(/^[^:]+:\s*/, '') || '获取微博信息失败');
}

async function requestJson(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: buildHeaders(referer)
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('微博需要登录或权限不可见');
    }

    if (response.status === 404) {
      throw new Error('微博不存在或不可访问');
    }

    if (!response.ok) {
      throw new Error(`微博接口请求失败，HTTP ${response.status}`);
    }

    const text = await response.text();
    const lowered = text.slice(0, 300).toLowerCase();

    if (lowered.includes('login') && lowered.includes('weibo')) {
      throw new Error('微博需要登录');
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error('接口返回结构异常');
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('请求超时');
    }

    throw new Error(mapNetworkError(error));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWeiboDetailHtml(parsed) {
  try {
    const text = await requestText(parsed.inputUrl, parsed.publishUrl);
    return text;
  } catch (error) {
    console.info(`[followers] ${parsed.publishUrl} 当前微博详情页公开 HTML 未获取: ${error.message}`);
    return '';
  }
}

async function requestText(url, referer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        ...buildHeaders(referer),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`当前微博详情页请求失败，HTTP ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('当前微博详情页请求超时');
    }

    throw new Error(mapNetworkError(error));
  } finally {
    clearTimeout(timer);
  }
}

function buildHeaders(referer) {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: referer,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest'
  };

  const cookie = getEffectiveWeiboCookie();
  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}

function extractStatusPayload(json) {
  if (!json || typeof json !== 'object') {
    return null;
  }

  if (json.ok === 0) {
    const message = json.msg || json.message || '微博不存在或权限不可见';
    throw new Error(String(message));
  }

  if (json.data && typeof json.data === 'object') {
    return json.data;
  }

  if (json.id || json.idstr || json.mblogid) {
    return json;
  }

  return null;
}

function normalizeStatusData(data, parsed, followers = '未获取') {
  const user = data.user || {};
  const publishTime = formatWeiboTime(data.created_at || data.createdAt || '');
  const content = stripHtml(data.text_raw || data.longTextContent || data.text || data.title || '');
  const accountName = user.screen_name || user.name || data.screen_name || '';
  const publishUrl = data.mblogid
    ? `${WEIBO_WEB_HOST}/${parsed.uid}/${data.mblogid}`
    : parsed.publishUrl;

  const comments = pickNumber(data.comments_count, data.comment_count, data.comments);
  const likes = pickNumber(data.attitudes_count, data.like_count, data.likes);
  const reposts = pickNumber(data.reposts_count, data.repost_count, data.reposts);

  if (!content && !accountName && comments === '' && likes === '' && reposts === '') {
    throw new Error('接口返回结构异常');
  }

  return {
    publishTime,
    content,
    accountName,
    publishUrl,
    comments,
    likes,
    reposts,
    followers
  };
}

function getAuthorUid(data, fallbackUid) {
  const user = data?.user || data?.mblog?.user || {};
  return String(user.idstr || user.id || fallbackUid || '');
}

async function getFollowersCount({ mblog, html, uid, cache, sourceUrl }) {
  const direct = extractFollowersCount(mblog, html, sourceUrl, { logMissing: false });
  if (direct !== '未获取') {
    return direct;
  }

  if (!uid) {
    console.info('[followers] uid=unknown source=未获取 raw=未获取 parsed=未获取');
    return '未获取';
  }

  if (cache?.has(uid)) {
    const cached = await cache.get(uid);
    console.info(`[followers] uid=${uid} source=cache parsed=${cached}`);
    return cached;
  }

  const profileFollowersPromise = (async () => {
    await randomDelay(REQUEST_DELAY_MIN_MS, REQUEST_DELAY_MAX_MS);
    return fetchAuthorFollowers(uid, sourceUrl);
  })();

  if (cache) {
    cache.set(uid, profileFollowersPromise);
  }

  const fromProfile = await profileFollowersPromise;

  if (cache) {
    cache.set(uid, fromProfile);
  }

  return fromProfile;
}

async function fetchAuthorFollowers(uid, sourceUrl = '') {
  const profileUrl = `${WEIBO_WEB_HOST}/ajax/profile/info?uid=${encodeURIComponent(uid)}`;

  try {
    const json = await requestJson(profileUrl, `${WEIBO_WEB_HOST}/${uid}`);
    const candidates = [
      ['data.user.followers_count_str', json?.data?.user?.followers_count_str],
      ['data.user.followers_count', json?.data?.user?.followers_count],
      ['data.user.followersCount', json?.data?.user?.followersCount],
      ['data.user.fans_count', json?.data?.user?.fans_count],
      ['data.user.fansCount', json?.data?.user?.fansCount],
      ['data.followers_count_str', json?.data?.followers_count_str],
      ['data.followers_count', json?.data?.followers_count],
      ['data.followersCount', json?.data?.followersCount],
      ['data.fans_count', json?.data?.fans_count],
      ['data.fansCount', json?.data?.fansCount],
      ['user.followers_count_str', json?.user?.followers_count_str],
      ['user.followers_count', json?.user?.followers_count],
      ['user.followersCount', json?.user?.followersCount],
      ['user.fans_count', json?.user?.fans_count],
      ['user.fansCount', json?.user?.fansCount],
      ['followers_count_str', json?.followers_count_str],
      ['followers_count', json?.followers_count],
      ['followersCount', json?.followersCount],
      ['fans_count', json?.fans_count],
      ['fansCount', json?.fansCount]
    ];

    for (const [field, value] of candidates) {
      const parsed = parseWeiboCount(value);
      if (parsed !== '未获取') {
        console.info(`[followers] uid=${uid} source=profile field=${field} raw=${value} parsed=${parsed}`);
        return parsed;
      }
    }

    console.info(`[followers] uid=${uid} source=profile raw=未获取 parsed=未获取`);
    return '未获取';
  } catch (error) {
    console.info(`[followers] uid=${uid} source=profile raw=未获取 parsed=未获取 reason=${error.message}`);
    return '未获取';
  }
}

export function extractFollowersCount(mblog, html = '', sourceUrl = '', options = {}) {
  const directUser = mblog?.user || {};
  const nestedUser = mblog?.mblog?.user || {};
  const authorUid = String(nestedUser.id || nestedUser.idstr || directUser.id || directUser.idstr || '');
  const authorName = String(nestedUser.screen_name || nestedUser.name || directUser.screen_name || directUser.name || '');
  const candidates = [
    ['mblog.user.followers_count', nestedUser.followers_count],
    ['mblog.user.followers_count_str', nestedUser.followers_count_str],
    ['mblog.user.followersCount', nestedUser.followersCount],
    ['mblog.user.fans_count', nestedUser.fans_count],
    ['mblog.user.fansCount', nestedUser.fansCount],
    ['user.followers_count', directUser.followers_count],
    ['user.followers_count_str', directUser.followers_count_str],
    ['user.followersCount', directUser.followersCount],
    ['user.fans_count', directUser.fans_count],
    ['user.fansCount', directUser.fansCount],
    ['user.fans_num', directUser.fans_num],
    ['user.fansNum', directUser.fansNum]
  ];

  for (const [field, value] of candidates) {
    const count = parseWeiboCount(value);
    if (count !== '未获取') {
      logFollowersFound(sourceUrl, field, value, count);
      return count;
    }
  }

  const htmlFollowers = extractFollowersFromHtml(html, { authorUid, authorName });
  if (htmlFollowers !== '未获取') {
    logFollowersFound(sourceUrl, 'current_page_html', '公开页面展示值', htmlFollowers);
    return htmlFollowers;
  }

  if (options.logMissing !== false) {
    console.info(`[followers] ${sourceUrl || '当前微博'} 未在当前微博详情响应或公开页面中找到粉丝数字段`);
  }

  return '未获取';
}

function pickNumber(...values) {
  for (const value of values) {
    const count = parseWeiboCount(value);
    if (count !== '未获取') {
      return count;
    }
  }

  return '';
}

export function parseWeiboCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return '未获取';
  }

  const text = decodeHtmlEntities(value)
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const nearFollowersPatterns = [
    /粉丝\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)(万|亿)?/,
    /([0-9]+(?:\.[0-9]+)?)(万|亿)?\s*粉丝/
  ];
  const directPattern = /^([0-9]+(?:\.[0-9]+)?)(万|亿)?$/;

  let match = directPattern.exec(text);
  if (!match) {
    for (const pattern of nearFollowersPatterns) {
      match = pattern.exec(text);
      if (match) break;
    }
  }

  if (!match) {
    return '未获取';
  }

  const number = Number(match[1]);
  if (Number.isNaN(number)) {
    return '未获取';
  }

  if (match[2] === '亿') {
    return Math.round(number * 100000000);
  }

  if (match[2] === '万') {
    return Math.round(number * 10000);
  }

  return number;
}

export function extractFollowersFromHtml(html, options = {}) {
  if (!html) {
    return '未获取';
  }

  const authorUid = String(options.authorUid || '');
  const authorName = String(options.authorName || '');
  const normalized = decodeHtmlEntities(html)
    .replace(/\\u002F/g, '/')
    .replace(/\\u003C/g, '<')
    .replace(/\\u003E/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
  const fieldPatterns = [
    /"followers_count"\s*:\s*"?([^",}\]<]+)"?/gi,
    /"followers_count_str"\s*:\s*"([^"]+)"/gi,
    /"followersCount"\s*:\s*"?([^",}\]<]+)"?/gi,
    /"fans_count"\s*:\s*"?([^",}\]<]+)"?/gi,
    /"fansCount"\s*:\s*"?([^",}\]<]+)"?/gi
  ];

  for (const pattern of fieldPatterns) {
    let match;
    while ((match = pattern.exec(normalized))) {
      const context = normalized.slice(Math.max(0, match.index - 500), match.index + 500);
      if (!isAuthorContext(context, authorUid, authorName)) {
        continue;
      }

      const parsed = parseWeiboCount(match[1]);
      if (parsed !== '未获取') {
        return parsed;
      }
    }
  }

  const visiblePatterns = [
    /([0-9][0-9.,]*(?:\.[0-9]+)?\s*(?:万|亿)?)\s*粉丝/g,
    /粉丝\s*[:：]?\s*([0-9][0-9.,]*(?:\.[0-9]+)?\s*(?:万|亿)?)/g
  ];

  for (const pattern of visiblePatterns) {
    let match;
    while ((match = pattern.exec(normalized))) {
      const parsed = parseWeiboCount(`${match[1]} 粉丝`);
      if (parsed !== '未获取') {
        return parsed;
      }
    }
  }

  return '未获取';
}

function isAuthorContext(context, authorUid, authorName) {
  return Boolean(
    (authorUid && context.includes(authorUid)) ||
    (authorName && context.includes(authorName))
  );
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function logFollowersFound(sourceUrl, field, rawValue, parsedValue) {
  console.info(`[followers] ${sourceUrl || '当前微博'} 找到粉丝数字段 ${field}: ${rawValue} -> ${parsedValue}`);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function formatWeiboTime(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const pad = (number) => String(number).padStart(2, '0');

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + ' ' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(':');
}

function mapNetworkError(error) {
  const message = String(error?.message || '');

  if (/timeout|aborted/i.test(message)) {
    return '请求超时';
  }

  if (/fetch failed|network|getaddrinfo|econnreset|enotfound|etimedout/i.test(message)) {
    return '网络错误';
  }

  return message || '请求失败';
}

function makeFailure(inputUrl, error, publishUrl = inputUrl) {
  return {
    success: false,
    inputUrl,
    publishTime: '',
    content: error,
    accountName: '',
    publishUrl,
    comments: '',
    likes: '',
    reposts: '',
    followers: '',
    error
  };
}

function shouldRetry(result) {
  const error = result?.error || result?.content || '';
  return !/链接格式|未配置微博 Cookie|Cookie 不能为空/.test(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(delay);
}
