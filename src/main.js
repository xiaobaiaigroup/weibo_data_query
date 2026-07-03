import './styles/main.css';
import { clearCookie, getConfigStatus, saveCookie } from './api/config.js';
import { batchQueryWeibo } from './api/weibo.js';
import { COLUMNS, buildColumnText, buildMultiColumnText, buildTSV, sanitizeCell } from './utils/copy.js';

const MISSING_COOKIE_MESSAGE = '未配置微博 Cookie，请点击右上角“Cookie 设置”填写后再查询。';
const MAX_BATCH_URLS = 50;
const COMPLIANCE_NOTICE = '本工具仅用于公司内部授权范围内的少量微博链接信息整理。请勿用于绕过平台限制、批量高频抓取、采集非公开信息、个人信息画像、数据售卖或任何违反平台规则及法律法规的用途。';
const INTERACTION_FIELDS = ['reposts', 'comments', 'likes'];
const INPUT_PLACEHOLDER = [
  '粘贴微博链接，每行一个',
  '单次最多 50 条。出于合规与安全限制，每条请求之间会有 0.5s-1s 延迟，请耐心等待。',
  '例如：',
  'https://weibo.com/7524946997/5263319904816444',
  'https://weibo.com/5747757876/5263316721077979',
  'https://weibo.com/5235744929/Qqz6ClzRG'
].join('\n');

const state = {
  loading: false,
  rows: [],
  stats: {
    total: 0,
    success: 0,
    failed: 0
  },
  hasCookie: false,
  maskedCookie: '',
  toastTimer: null
};

document.querySelector('#app').innerHTML = `
  <main class="page-shell">
    <header class="page-header">
      <div class="header-action-bar">
        <button id="cookieSettingsBtn" class="btn btn-settings" type="button">Cookie 设置</button>
      </div>
      <h1>微博信息批量查询</h1>
      <p>粘贴微博链接（每行一个），获取发布日期、发布内容、账号名称、评论数、点赞数、转发数、粉丝数等数据</p>
      <div id="cookieStatus" class="cookie-status">正在读取 Cookie 配置...</div>
    </header>

    <section class="input-panel" aria-label="批量输入">
      <div class="input-toolbar">
        <button id="pasteClipboardBtn" class="btn btn-paste" type="button">一键粘贴</button>
      </div>
      <textarea id="urlInput" spellcheck="false" placeholder="${INPUT_PLACEHOLDER}"></textarea>
      <div class="action-row">
        <button id="queryBtn" class="btn btn-primary" type="button">批量查询</button>
        <button id="clearBtn" class="btn btn-muted" type="button">清空</button>
        <button id="copyTableBtn" class="btn btn-copy" type="button" disabled>复制表格</button>
        <button id="copyDataBtn" class="btn btn-copy" type="button" disabled>复制数据</button>
      </div>
    </section>

    <section class="stats-row" aria-live="polite">
      <span>共 <strong id="totalCount">0</strong> 条</span>
      <span class="stat-success">成功 <strong id="successCount">0</strong> 条</span>
      <span class="stat-failed">失败 <strong id="failedCount">0</strong> 条</span>
    </section>

    <section id="messageBox" class="message-box" hidden></section>

    <section class="result-panel" aria-label="查询结果">
      <div class="table-scroll">
        <table>
          <thead>
            <tr class="header-label-row">
              ${COLUMNS.map((column) => `
                <th>
                  <span class="th-label">${column.label}</span>
                </th>
              `).join('')}
            </tr>
            <tr class="header-copy-row">
              ${renderHeaderCopyCells()}
            </tr>
          </thead>
          <tbody id="resultBody">
            <tr class="empty-row">
              <td colspan="${COLUMNS.length}">暂无结果</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <footer class="compliance-footer">${COMPLIANCE_NOTICE}</footer>
  </main>

  <div id="cookieModal" class="modal-backdrop" hidden>
    <section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="cookieModalTitle">
      <div class="modal-header">
        <h2 id="cookieModalTitle">微博 Cookie 设置</h2>
        <button id="closeCookieBtn" class="icon-btn" type="button" aria-label="关闭">×</button>
      </div>
      <p class="modal-desc">请粘贴公司提供的微博 Cookie。Cookie 只会保存在本机配置文件中，不会写入源码。</p>
      <div id="cookieMask" class="cookie-mask">未配置 Cookie</div>
      <textarea id="cookieInput" class="cookie-input" spellcheck="false" placeholder="在这里粘贴微博 Cookie"></textarea>
      <div class="modal-actions">
        <button id="saveCookieBtn" class="btn btn-primary" type="button">保存 Cookie</button>
        <button id="clearCookieBtn" class="btn btn-muted" type="button">清空 Cookie</button>
        <button id="cancelCookieBtn" class="btn btn-copy" type="button">关闭</button>
      </div>
    </section>
  </div>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>
`;

const urlInput = document.querySelector('#urlInput');
const queryBtn = document.querySelector('#queryBtn');
const pasteClipboardBtn = document.querySelector('#pasteClipboardBtn');
const clearBtn = document.querySelector('#clearBtn');
const copyTableBtn = document.querySelector('#copyTableBtn');
const copyDataBtn = document.querySelector('#copyDataBtn');
const resultBody = document.querySelector('#resultBody');
const messageBox = document.querySelector('#messageBox');
const totalCount = document.querySelector('#totalCount');
const successCount = document.querySelector('#successCount');
const failedCount = document.querySelector('#failedCount');
const toast = document.querySelector('#toast');
const cookieStatus = document.querySelector('#cookieStatus');
const cookieSettingsBtn = document.querySelector('#cookieSettingsBtn');
const cookieModal = document.querySelector('#cookieModal');
const cookieInput = document.querySelector('#cookieInput');
const cookieMask = document.querySelector('#cookieMask');
const saveCookieBtn = document.querySelector('#saveCookieBtn');
const clearCookieBtn = document.querySelector('#clearCookieBtn');
const closeCookieBtn = document.querySelector('#closeCookieBtn');
const cancelCookieBtn = document.querySelector('#cancelCookieBtn');

queryBtn.addEventListener('click', handleBatchQuery);
pasteClipboardBtn.addEventListener('click', handlePasteFromClipboard);
clearBtn.addEventListener('click', clearAll);
copyTableBtn.addEventListener('click', () => copyText(buildTSV(state.rows, true), '已复制表格，可直接粘贴到 Excel / WPS'));
copyDataBtn.addEventListener('click', () => copyText(buildTSV(state.rows, false), '已复制数据，可直接粘贴到 Excel / WPS'));
cookieSettingsBtn.addEventListener('click', openCookieModal);
saveCookieBtn.addEventListener('click', handleSaveCookie);
clearCookieBtn.addEventListener('click', handleClearCookie);
closeCookieBtn.addEventListener('click', closeCookieModal);
cancelCookieBtn.addEventListener('click', closeCookieModal);
cookieModal.addEventListener('click', (event) => {
  if (event.target === cookieModal) {
    closeCookieModal();
  }
});

document.querySelectorAll('.column-copy-btn').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.fields) {
      const fields = button.dataset.fields.split(',').filter(Boolean);
      copyText(buildMultiColumnText(state.rows, fields), '已复制互动量，可直接粘贴到 Excel / WPS');
      return;
    }

    const field = button.dataset.field;
    const label = button.dataset.label;
    copyText(buildColumnText(state.rows, field), `已复制“${label}”列，可直接粘贴到 Excel / WPS 的单列中`);
  });
});

refreshCookieStatus(true);

function renderHeaderCopyCells() {
  return COLUMNS.map((column) => {
    if (column.key === INTERACTION_FIELDS[0]) {
      return `<th class="header-copy-cell interaction-copy-cell" colspan="${INTERACTION_FIELDS.length}">${renderInteractionCopyButton()}</th>`;
    }

    if (INTERACTION_FIELDS.slice(1).includes(column.key)) {
      return '';
    }

    return `<th class="header-copy-cell">${renderHeaderCopyButton(column)}</th>`;
  }).join('');
}

function renderInteractionCopyButton() {
  return `<button class="column-copy-btn column-copy-btn-wide" type="button" data-fields="${INTERACTION_FIELDS.join(',')}" data-label="互动量" disabled>复制互动量</button>`;
}

function renderHeaderCopyButton(column) {
  if (INTERACTION_FIELDS.includes(column.key)) {
    return '';
  }

  return `<button class="column-copy-btn" type="button" data-field="${column.key}" data-label="${column.label}" disabled>复制</button>`;
}

function parseInputUrls() {
  return urlInput.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function handleBatchQuery() {
  const urls = parseInputUrls();

  if (urls.length === 0) {
    showMessage('请输入至少一条微博链接', 'error');
    return;
  }

  if (urls.length > MAX_BATCH_URLS) {
    showMessage('单次最多查询 50 条，请分批处理', 'warning');
    return;
  }

  await refreshCookieStatus(false);
  if (!state.hasCookie) {
    showMessage(MISSING_COOKIE_MESSAGE, 'warning');
    return;
  }

  setLoading(true);
  showMessage(`正在查询 ${urls.length} 条链接...`, 'info');
  state.rows = [];
  renderRows();
  updateStats({ total: urls.length, success: 0, failed: 0 });

  try {
    const payload = await batchQueryWeibo(urls);
    state.rows = Array.isArray(payload.data) ? payload.data : [];
    updateStats({
      total: payload.total ?? state.rows.length,
      success: payload.success ?? state.rows.filter((row) => row.success).length,
      failed: payload.failed ?? state.rows.filter((row) => !row.success).length
    });
    renderRows();
    showMessage('查询完成', payload.failed > 0 ? 'warning' : 'success');
  } catch (error) {
    state.rows = urls.map((url) => makeFailureRow(url, error.message || '批量查询失败'));
    updateStats({ total: state.rows.length, success: 0, failed: state.rows.length });
    renderRows();
    showMessage(error.message || '批量查询失败', 'error');
  } finally {
    setLoading(false);
  }
}

async function handlePasteFromClipboard() {
  const readClipboardText = window.weiboDesktop?.readClipboardText || navigator.clipboard?.readText?.bind(navigator.clipboard);

  if (!readClipboardText) {
    showMessage('当前环境不支持读取剪贴板，请使用 Ctrl+V 粘贴', 'warning');
    return;
  }

  try {
    const text = await readClipboardText();
    const trimmedText = text.trim();

    if (!trimmedText) {
      showMessage('剪贴板为空', 'warning');
      return;
    }

    const currentText = urlInput.value.trim();
    urlInput.value = currentText ? `${currentText}\n${trimmedText}` : trimmedText;
    showMessage('已粘贴剪贴板内容', 'success');
    showToast('已粘贴剪贴板内容');
    urlInput.focus();
  } catch (error) {
    showMessage('当前环境不支持读取剪贴板，请使用 Ctrl+V 粘贴', 'warning');
  }
}

async function refreshCookieStatus(showInitialWarning = false) {
  try {
    const status = await getConfigStatus();
    state.hasCookie = Boolean(status.hasCookie);
    state.maskedCookie = status.maskedCookie || '';
    renderCookieStatus();

    if (!state.hasCookie && showInitialWarning) {
      showMessage(MISSING_COOKIE_MESSAGE, 'warning');
    }
  } catch (error) {
    state.hasCookie = false;
    state.maskedCookie = '';
    renderCookieStatus(error.message || '读取 Cookie 配置失败');
    showMessage(error.message || '读取 Cookie 配置失败', 'error');
  }
}

function renderCookieStatus(errorText = '') {
  if (errorText) {
    cookieStatus.className = 'cookie-status cookie-status-error';
    cookieStatus.textContent = errorText;
    cookieMask.textContent = errorText;
    return;
  }

  if (state.hasCookie) {
    cookieStatus.className = 'cookie-status cookie-status-ok';
    cookieStatus.textContent = `已配置 Cookie：${state.maskedCookie}`;
    cookieMask.textContent = `已配置 Cookie：${state.maskedCookie}`;
    return;
  }

  cookieStatus.className = 'cookie-status cookie-status-missing';
  cookieStatus.textContent = MISSING_COOKIE_MESSAGE;
  cookieMask.textContent = '未配置 Cookie';
}

function openCookieModal() {
  cookieInput.value = '';
  renderCookieStatus();
  cookieModal.hidden = false;
  setTimeout(() => cookieInput.focus(), 0);
}

function closeCookieModal() {
  cookieModal.hidden = true;
  cookieInput.value = '';
}

async function handleSaveCookie() {
  const cookie = cookieInput.value.trim();

  if (!cookie) {
    showToast('请先粘贴 Cookie');
    return;
  }

  try {
    const result = await saveCookie(cookie);
    cookieInput.value = '';
    await refreshCookieStatus(false);
    showToast(`${result.message || 'Cookie 已保存'}，请重新查询`);
    showMessage('Cookie 已保存，请重新查询', 'success');
  } catch (error) {
    showToast(error.message || 'Cookie 保存失败');
  }
}

async function handleClearCookie() {
  try {
    const result = await clearCookie();
    cookieInput.value = '';
    await refreshCookieStatus(false);
    showToast(result.message || 'Cookie 已清空');
    showMessage(MISSING_COOKIE_MESSAGE, 'warning');
  } catch (error) {
    showToast(error.message || 'Cookie 清空失败');
  }
}

function makeFailureRow(url, error) {
  return {
    success: false,
    inputUrl: url,
    publishTime: '',
    content: error,
    accountName: '',
    publishUrl: url,
    comments: '',
    likes: '',
    reposts: '',
    followers: '',
    error
  };
}

function renderRows() {
  setCopyEnabled(state.rows.length > 0);

  if (state.rows.length === 0) {
    resultBody.innerHTML = `<tr class="empty-row"><td colspan="${COLUMNS.length}">暂无结果</td></tr>`;
    return;
  }

  resultBody.innerHTML = state.rows.map((row) => {
    const rowClass = row.success ? '' : ' class="row-failed"';
    return `
      <tr${rowClass}>
        ${COLUMNS.map((column) => renderCell(row, column)).join('')}
      </tr>
    `;
  }).join('');
}

function renderCell(row, column) {
  const rawValue = row?.[column.key];
  const value = sanitizeCell(rawValue);
  const title = escapeAttribute(value);
  const className = column.className || '';

  if (column.key === 'publishUrl' && value) {
    return `<td class="${className}" title="${title}"><a href="${escapeAttribute(value)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a></td>`;
  }

  return `<td class="${className}" title="${title}">${escapeHtml(value)}</td>`;
}

function updateStats(nextStats) {
  state.stats = nextStats;
  totalCount.textContent = String(nextStats.total);
  successCount.textContent = String(nextStats.success);
  failedCount.textContent = String(nextStats.failed);
}

function setLoading(isLoading) {
  state.loading = isLoading;
  queryBtn.disabled = isLoading;
  pasteClipboardBtn.disabled = isLoading;
  queryBtn.textContent = isLoading ? '查询中...' : '批量查询';
  urlInput.disabled = isLoading;
}

function setCopyEnabled(enabled) {
  copyTableBtn.disabled = !enabled;
  copyDataBtn.disabled = !enabled;
  document.querySelectorAll('.column-copy-btn').forEach((button) => {
    button.disabled = !enabled;
  });
}

function clearAll() {
  urlInput.value = '';
  state.rows = [];
  updateStats({ total: 0, success: 0, failed: 0 });
  renderRows();
  hideMessage();

  if (!state.hasCookie) {
    showMessage(MISSING_COOKIE_MESSAGE, 'warning');
  }
}

async function copyText(text, message) {
  if (!state.rows.length) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch (error) {
    showToast('复制失败，请检查剪贴板权限');
  }
}

function showMessage(message, type) {
  messageBox.hidden = false;
  messageBox.className = `message-box message-${type}`;
  messageBox.textContent = message;
}

function hideMessage() {
  messageBox.hidden = true;
  messageBox.textContent = '';
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('toast-visible');

  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
  }

  state.toastTimer = setTimeout(() => {
    toast.classList.remove('toast-visible');
  }, 2200);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
