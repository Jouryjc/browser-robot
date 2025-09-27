import express, { Request, Response } from 'express';
import { mcpService } from '../services/mcp-service.js';
import { connectionMonitor } from '../services/connection-monitor.js';
import { mcpLogger } from '../utils/logger.js';

const router = express.Router();

/**
 * 获取MCP服务状态
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const metrics = mcpService.getConnectionQualityMetrics();
    
    res.json({
      success: true,
      data: {
        ...metrics,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    mcpLogger.error('获取MCP状态失败', {}, error);
    res.status(500).json({
      success: false,
      error: '获取MCP状态失败',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * 测试MCP工具调用
 */
router.post('/test-tool', async (req: Request, res: Response) => {
  try {
    const { toolName, args = {} } = req.body;
    
    if (!toolName) {
      return res.status(400).json({
        success: false,
        error: '缺少工具名称'
      });
    }

    const result = await mcpService.callTool(toolName, args);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    mcpLogger.error('MCP工具调用失败', {}, error);
    res.status(500).json({
      success: false,
      error: 'MCP工具调用失败',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * 获取连接监控状态
 */
router.get('/monitor/status', async (req: Request, res: Response) => {
  try {
    const monitoringStatus = connectionMonitor.getMonitoringStatus();
    const connectionStats = connectionMonitor.getConnectionStats();
    
    res.json({
      success: true,
      data: {
        monitoring: monitoringStatus,
        stats: connectionStats,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    mcpLogger.error('获取监控状态失败', {}, error);
    res.status(500).json({
      success: false,
      error: '获取监控状态失败',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * 获取连接历史记录
 */
router.get('/monitor/history', async (req: Request, res: Response) => {
  try {
    const history = connectionMonitor.getConnectionHistory();
    
    res.json({
      success: true,
      data: {
        history,
        count: history.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    mcpLogger.error('获取连接历史失败', {}, error);
    res.status(500).json({
      success: false,
      error: '获取连接历史失败',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * 启动连接监控
 */
router.post('/monitor/start', async (req: Request, res: Response) => {
  try {
    connectionMonitor.startMonitoring();
    
    res.json({
      success: true,
      message: '连接监控已启动',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    mcpLogger.error('启动连接监控失败', {}, error);
    res.status(500).json({
      success: false,
      error: '启动连接监控失败',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * 停止连接监控
 */
router.post('/monitor/stop', async (req: Request, res: Response) => {
  try {
    connectionMonitor.stopMonitoring();
    
    res.json({
      success: true,
      message: '连接监控已停止',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    mcpLogger.error('停止连接监控失败', {}, error);
    res.status(500).json({
      success: false,
      error: '停止连接监控失败',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;