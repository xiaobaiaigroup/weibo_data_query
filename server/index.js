import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { findAvailablePort } from './utils/ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const startPort = Number(process.env.PORT || 3001);
const app = createApp({
  configDir: path.resolve(__dirname, '..'),
  staticDir: path.resolve(__dirname, '..', 'dist')
});

try {
  const port = await findAvailablePort(startPort);
  app.listen(port, '127.0.0.1', () => {
    console.log(`Weibo data query API listening on http://127.0.0.1:${port}`);
  });
} catch (error) {
  console.error(error?.message || '服务启动失败');
  process.exit(1);
}
