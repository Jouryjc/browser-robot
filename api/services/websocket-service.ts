/**
 * WebSocket服务
 * 用于实时推送任务执行日志到前端
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { wsLogger } from '../utils/logger.js';

/**
 * WebSocket消息类型
 */
export interface WebSocketMessage {
  type: 'task_log' | 'task_status' | 'task_step' | 'error';
  taskId: string;
  data: any;
  timestamp: Date;
}

/**
 * WebSocket服务类
 */
export class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, Set<WebSocket>> = new Map(); // taskId -> WebSocket集合

  /**
   * 初始化WebSocket服务器
   * @param server HTTP服务器实例
   */
  initialize(server: Server): void {
    wsLogger.info('正在初始化WebSocket服务器...');
    
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws' // WebSocket路径
    });

    this.wss.on('connection', (ws: WebSocket, request) => {
      wsLogger.info('新的WebSocket连接建立');
      wsLogger.debug('请求URL', {}, request.url);
      wsLogger.debug('请求头', {}, request.headers);
      
      // 从查询参数中获取taskId
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      const taskId = url.searchParams.get('taskId');
      
      wsLogger.debug('解析的taskId', {}, taskId);
      
      if (!taskId) {
        wsLogger.warn('WebSocket连接缺少taskId参数，关闭连接');
        ws.close(1008, 'Missing taskId parameter');
        return;
      }

      // 将客户端添加到对应任务的订阅列表
      if (!this.clients.has(taskId)) {
        this.clients.set(taskId, new Set());
      }
      this.clients.get(taskId)!.add(ws);
      
      wsLogger.info(`客户端订阅任务 ${taskId} 的实时更新`);

      // 处理连接关闭
      ws.on('close', (code, reason) => {
        wsLogger.info(`客户端断开连接，任务ID: ${taskId}, 代码: ${code}, 原因: ${reason}`);
        const taskClients = this.clients.get(taskId);
        if (taskClients) {
          taskClients.delete(ws);
          if (taskClients.size === 0) {
            this.clients.delete(taskId);
            wsLogger.info(`任务 ${taskId} 的所有客户端已断开连接`);
          }
        }
      });

      // 处理连接错误
      ws.on('error', (error) => {
        wsLogger.error(`WebSocket连接错误，任务ID: ${taskId}`, {}, error);
        const taskClients = this.clients.get(taskId);
        if (taskClients) {
          taskClients.delete(ws);
        }
      });

      // 发送连接确认消息
      this.sendToClient(ws, {
        type: 'task_status',
        taskId,
        data: { message: 'WebSocket连接已建立' },
        timestamp: new Date()
      });
    });

    // 添加WebSocket服务器错误处理
    this.wss.on('error', (error) => {
      wsLogger.error('WebSocket服务器错误', {}, error);
    });

    wsLogger.info('WebSocket服务器初始化完成，路径: /ws');
  }

  /**
   * 向指定任务的所有客户端广播消息
   * @param taskId 任务ID
   * @param message 消息内容
   */
  broadcastToTask(taskId: string, message: WebSocketMessage): void {
    const taskClients = this.clients.get(taskId);
    if (!taskClients || taskClients.size === 0) {
      wsLogger.debug(`没有客户端订阅任务 ${taskId}，跳过WebSocket推送`);
      return; // 没有客户端订阅此任务
    }

    wsLogger.info(`向任务 ${taskId} 的 ${taskClients.size} 个客户端推送消息: ${message.type}`);
    const messageStr = JSON.stringify(message);
    const deadClients: WebSocket[] = [];

    taskClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(messageStr);
          wsLogger.debug(`成功向任务 ${taskId} 推送消息`);
        } catch (error) {
          wsLogger.error(`发送WebSocket消息失败，任务ID: ${taskId}`, error);
          deadClients.push(ws);
        }
      } else {
        deadClients.push(ws);
      }
    });

    // 清理已断开的连接
    deadClients.forEach(ws => {
      taskClients.delete(ws);
    });

    if (taskClients.size === 0) {
      this.clients.delete(taskId);
    }
  }

  /**
   * 发送任务日志
   * @param taskId 任务ID
   * @param log 日志内容
   */
  sendTaskLog(taskId: string, log: any): void {
    this.broadcastToTask(taskId, {
      type: 'task_log',
      taskId,
      data: log,
      timestamp: new Date()
    });
  }

  /**
   * 发送任务状态更新
   * @param taskId 任务ID
   * @param status 状态信息
   */
  sendTaskStatus(taskId: string, status: any): void {
    this.broadcastToTask(taskId, {
      type: 'task_status',
      taskId,
      data: status,
      timestamp: new Date()
    });
  }

  /**
   * 发送任务步骤更新
   * @param taskId 任务ID
   * @param step 步骤信息
   */
  sendTaskStep(taskId: string, step: any): void {
    this.broadcastToTask(taskId, {
      type: 'task_step',
      taskId,
      data: step,
      timestamp: new Date()
    });
  }

  /**
   * 发送错误消息
   * @param taskId 任务ID
   * @param error 错误信息
   */
  sendError(taskId: string, error: any): void {
    this.broadcastToTask(taskId, {
      type: 'error',
      taskId,
      data: error,
      timestamp: new Date()
    });
  }

  /**
   * 向单个客户端发送消息
   * @param ws WebSocket连接
   * @param message 消息内容
   */
  private sendToClient(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        wsLogger.error('发送WebSocket消息失败:', error);
      }
    }
  }

  /**
   * 获取指定任务的客户端数量
   * @param taskId 任务ID
   * @returns 客户端数量
   */
  getClientCount(taskId: string): number {
    const taskClients = this.clients.get(taskId);
    return taskClients ? taskClients.size : 0;
  }

  /**
   * 获取所有活跃的任务ID
   * @returns 任务ID数组
   */
  getActiveTaskIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * 关闭WebSocket服务器
   */
  close(): void {
    if (this.wss) {
      wsLogger.info('正在关闭WebSocket服务器...');
      this.wss.close();
      this.clients.clear();
      wsLogger.info('WebSocket服务器已关闭');
    }
  }
}

// 导出单例实例
export const webSocketService = new WebSocketService();