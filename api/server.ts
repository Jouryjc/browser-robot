/**
 * local server entry file, for local development
 */
import app, { initializeServices, shutdownServices } from './app.js';
import { serverLogger } from './utils/logger.js';

const PORT = process.env.PORT || 3002;

const server = app.listen(PORT, async () => {
  serverLogger.info(`服务器已启动，监听端口 ${PORT}`);
  
  // 初始化所有服务
  await initializeServices(server);
});

// 优雅关闭处理
process.on('SIGTERM', async () => {
  serverLogger.info('收到 SIGTERM 信号');
  await shutdownServices();
  server.close(() => {
    serverLogger.info('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  serverLogger.info('收到 SIGINT 信号');
  await shutdownServices();
  server.close(() => {
    serverLogger.info('服务器已关闭');
    process.exit(0);
  });
});

export default app;