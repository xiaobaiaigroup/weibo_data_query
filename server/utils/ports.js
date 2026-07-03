import net from 'node:net';

export function findAvailablePort(startPort = 3001, maxAttempts = 50) {
  return new Promise((resolve, reject) => {
    let currentPort = Number(startPort) || 3001;
    let attempts = 0;

    function tryPort() {
      if (attempts >= maxAttempts) {
        reject(new Error(`未找到可用端口，已尝试 ${startPort}-${currentPort - 1}`));
        return;
      }

      const server = net.createServer();
      attempts += 1;

      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
          currentPort += 1;
          tryPort();
          return;
        }

        reject(error);
      });

      server.once('listening', () => {
        server.close(() => resolve(currentPort));
      });

      server.listen(currentPort, '127.0.0.1');
    }

    tryPort();
  });
}
