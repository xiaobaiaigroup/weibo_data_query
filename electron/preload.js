import { clipboard, contextBridge } from 'electron';

const apiBaseArgument = process.argv.find((argument) => argument.startsWith('--weibo-api-base-url='));
const apiBaseUrl = apiBaseArgument ? apiBaseArgument.replace('--weibo-api-base-url=', '') : '';

contextBridge.exposeInMainWorld('weiboDesktop', {
  apiBaseUrl,
  readClipboardText: () => clipboard.readText()
});
