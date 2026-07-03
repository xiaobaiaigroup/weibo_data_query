export const COLUMNS = [
  { key: 'publishTime', label: '发布日期', className: 'td-time' },
  { key: 'content', label: '发布内容', className: 'td-content' },
  { key: 'accountName', label: '账号名称', className: 'td-account' },
  { key: 'publishUrl', label: '发布链接', className: 'td-link' },
  { key: 'reposts', label: '转发数', className: 'td-number' },
  { key: 'comments', label: '评论数', className: 'td-number' },
  { key: 'likes', label: '点赞数', className: 'td-number' },
  { key: 'followers', label: '粉丝数', className: 'td-number' }
];

export function sanitizeCell(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .replace(/\t/g, ' ')
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildTSV(rows, includeHeader = true) {
  const lines = [];

  if (includeHeader) {
    lines.push(COLUMNS.map((column) => column.label).join('\t'));
  }

  rows.forEach((row) => {
    lines.push(COLUMNS.map((column) => sanitizeCell(row?.[column.key])).join('\t'));
  });

  return lines.join('\n');
}

export function buildColumnText(rows, fieldName) {
  return rows.map((row) => sanitizeCell(row?.[fieldName])).join('\n');
}

export function buildMultiColumnText(rows, fieldNames) {
  return rows
    .map((row) => fieldNames.map((fieldName) => sanitizeCell(row?.[fieldName])).join('\t'))
    .join('\n');
}
