import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import taskRoutes from './routes/tasks.js';
import mcpStatusRoutes from './routes/mcp-status.js';
import { webSocketService } from './services/websocket-service.js';
import { mcpService } from './services/mcp-service.js';
import { connectionMonitor } from './services/connection-monitor.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../dist')));

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/mcp', mcpStatusRoutes);

// 处理所有其他路由，返回 React 应用
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

export async function initializeServices(server: any) {
  try {
    // 初始化 WebSocket 服务
    webSocketService.initialize(server);
    logger.info('WebSocket 服务初始化完成');

    // 初始化 MCP 服务
    await mcpService.initialize();
    logger.info('MCP 服务初始化完成');

    // 启动连接监控
    connectionMonitor.startMonitoring();
    logger.info('连接监控服务已启动');

  } catch (error) {
    logger.error('服务初始化失败:', error);
    throw error;
  }
}

export async function shutdownServices() {
  try {
    logger.info('开始优雅关闭服务...');
    
    // 停止连接监控
    connectionMonitor.stopMonitoring();
    
    // 关闭 WebSocket 服务
    webSocketService.close();
    
    // 关闭 MCP 服务
    await mcpService.disconnect();
    
    logger.info('所有服务已关闭');
  } catch (error) {
    logger.error('关闭服务时出错:', error);
  }
}

export default app;
