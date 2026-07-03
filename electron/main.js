import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { findAvailablePort } from '../server/utils/ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let backendServer = null;
let backendUrl = '';

async function startBackend() {
  const startPort = Number(process.env.PORT || 3001);
  const port = await findAvailablePort(startPort, 80);
  const configDir = app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
    : path.resolve(__dirname, '..');
  const staticDir = path.resolve(__dirname, '..', 'dist');
  const expressApp = createApp({ configDir, staticDir });

  await new Promise((resolve, reject) => {
    backendServer = expressApp.listen(port, '127.0.0.1', resolve);
    backendServer.once('error', reject);
  });

  backendUrl = `http://127.0.0.1:${port}`;
  return backendUrl;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: '微博信息批量查询',
    backgroundColor: '#f4f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--weibo-api-base-url=${backendUrl}`]
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  attachContextMenu(mainWindow);
  mainWindow.loadURL(backendUrl);
}

function attachContextMenu(window) {
  window.webContents.on('context-menu', (event, params) => {
    const template = params.isEditable
      ? [
          { label: '剪切', role: 'cut' },
          { label: '复制', role: 'copy' },
          { label: '粘贴', role: 'paste' },
          { type: 'separator' },
          { label: '全选', role: 'selectAll' }
        ]
      : [
          { label: '复制', role: 'copy' },
          { type: 'separator' },
          { label: '全选', role: 'selectAll' }
        ];

    Menu.buildFromTemplate(template).popup({ window });
  });
}

async function bootstrap() {
  try {
    await startBackend();
    createWindow();
  } catch (error) {
    dialog.showErrorBox(
      '微博信息批量查询启动失败',
      error?.message || '无法启动本地服务，请检查端口占用或重新启动应用。'
    );
    app.quit();
  }
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (backendServer) {
    backendServer.close();
    backendServer = null;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backendUrl) {
    createWindow();
  }
});
