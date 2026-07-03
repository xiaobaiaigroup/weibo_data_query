import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import configRouter from './routes/config.js';
import weiboRouter from './routes/weibo.js';
import { ensureConfigFile, setConfigDirectory } from './services/configService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(options = {}) {
  const app = express();
  const staticDir = options.staticDir || path.resolve(__dirname, '..', 'dist');

  setConfigDirectory(options.configDir || path.resolve(__dirname, '..'));
  ensureConfigFile();

  app.use(express.json({ limit: '1mb' }));
  app.use('/api/config', configRouter);
  app.use('/api/weibo', weiboRouter);
  app.use(express.static(staticDir));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }

    res.sendFile(path.join(staticDir, 'index.html'), (error) => {
      if (error) {
        res.status(404).send('前端资源不存在，请先运行 npm run build，或使用 npm run dev:client 启动前端。');
      }
    });
  });

  return app;
}
