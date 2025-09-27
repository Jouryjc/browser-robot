import { EventEmitter } from 'events';
import { mcpService } from './mcp-service.js';
import { monitorLogger } from '../utils/logger.js';

/**
 * 连接监控服务
 * 提供实时连接监控和自动恢复机制
 */
export class ConnectionMonitor extends EventEmitter {
  private monitorInterval: NodeJS.Timeout | null = null;
  private monitorIntervalMs = 10000; // 每10秒监控一次
  private isMonitoring = false;
  private connectionHistory: ConnectionEvent[] = [];
  private maxHistorySize = 100;
  
  // 连接质量阈值
  private readonly qualityThresholds = {
    excellent: 95,  // 95%以上成功率为优秀
    good: 85,       // 85%以上成功率为良好
    poor: 70        // 70%以下成功率为较差
  };

  constructor() {
    super();
    this.setupEventListeners();
  }

  /**
   * 开始监控连接状态
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      monitorLogger.info('连接监控已在运行中');
      return;
    }

    monitorLogger.info('启动连接监控服务...');
    this.isMonitoring = true;
    
    this.monitorInterval = setInterval(async () => {
      await this.performMonitoringCheck();
    }, this.monitorIntervalMs);

    this.emit('monitoring-started');
  }

  /**
   * 停止监控连接状态
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    monitorLogger.info('停止连接监控服务...');
    this.isMonitoring = false;
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    this.emit('monitoring-stopped');
  }

  /**
   * 执行监控检查
   */
  private async performMonitoringCheck(): Promise<void> {
    try {
      const metrics = mcpService.getConnectionQualityMetrics();
      const connectionEvent: ConnectionEvent = {
        timestamp: new Date(),
        isConnected: metrics.isHealthy,
        successRate: metrics.successRate,
        consecutiveFailures: metrics.consecutiveHealthCheckFailures,
        totalConnections: metrics.totalConnections,
        lastHealthCheckTime: metrics.lastHealthCheckTime
      };

      this.addConnectionEvent(connectionEvent);

      // 分析连接质量
      const quality = this.analyzeConnectionQuality(metrics.successRate);
      
      // 发出连接状态事件
      this.emit('connection-status', {
        ...connectionEvent,
        quality
      });

      // 检查是否需要自动恢复
      if (!metrics.isHealthy && this.shouldTriggerAutoRecovery(metrics)) {
        monitorLogger.warn('检测到连接异常，触发自动恢复...');
        await this.triggerAutoRecovery();
      }

    } catch (error) {
      monitorLogger.error('连接监控检查失败', {}, error);
      this.emit('monitoring-error', error);
    }
  }

  /**
   * 分析连接质量
   */
  private analyzeConnectionQuality(successRate: number): 'excellent' | 'good' | 'fair' | 'poor' {
    if (successRate >= this.qualityThresholds.excellent) {
      return 'excellent';
    } else if (successRate >= this.qualityThresholds.good) {
      return 'good';
    } else if (successRate >= this.qualityThresholds.poor) {
      return 'fair';
    } else {
      return 'poor';
    }
  }

  /**
   * 判断是否应该触发自动恢复
   */
  private shouldTriggerAutoRecovery(metrics: any): boolean {
    // 如果连续健康检查失败次数超过2次，触发自动恢复
    if (metrics.consecutiveHealthCheckFailures >= 2) {
      return true;
    }

    // 如果成功率低于70%且最近有连接活动，触发自动恢复
    if (metrics.successRate < 70 && metrics.totalConnections > 0) {
      return true;
    }

    return false;
  }

  /**
   * 触发自动恢复
   */
  private async triggerAutoRecovery(): Promise<void> {
    try {
      monitorLogger.info('开始执行自动恢复...');
      this.emit('auto-recovery-started');

      // 尝试重新初始化MCP服务
      await mcpService.disconnect();
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
      await mcpService.initialize();

      monitorLogger.info('自动恢复完成');
      this.emit('auto-recovery-completed');

    } catch (error) {
      monitorLogger.error('自动恢复失败', {}, error);
      this.emit('auto-recovery-failed', error);
    }
  }

  /**
   * 添加连接事件到历史记录
   */
  private addConnectionEvent(event: ConnectionEvent): void {
    this.connectionHistory.push(event);
    
    // 保持历史记录大小在限制范围内
    if (this.connectionHistory.length > this.maxHistorySize) {
      this.connectionHistory.shift();
    }
  }

  /**
   * 获取连接历史记录
   */
  getConnectionHistory(): ConnectionEvent[] {
    return [...this.connectionHistory];
  }

  /**
   * 获取连接统计信息
   */
  getConnectionStats(): ConnectionStats {
    if (this.connectionHistory.length === 0) {
      return {
        totalEvents: 0,
        connectedEvents: 0,
        disconnectedEvents: 0,
        averageSuccessRate: 0,
        uptime: 0
      };
    }

    const connectedEvents = this.connectionHistory.filter(e => e.isConnected).length;
    const totalEvents = this.connectionHistory.length;
    const averageSuccessRate = this.connectionHistory.reduce((sum, e) => sum + e.successRate, 0) / totalEvents;
    
    // 计算运行时间（从第一个事件到最后一个事件）
    const firstEvent = this.connectionHistory[0];
    const lastEvent = this.connectionHistory[this.connectionHistory.length - 1];
    const uptime = lastEvent.timestamp.getTime() - firstEvent.timestamp.getTime();

    return {
      totalEvents,
      connectedEvents,
      disconnectedEvents: totalEvents - connectedEvents,
      averageSuccessRate: Math.round(averageSuccessRate * 100) / 100,
      uptime
    };
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 监听连接状态变化
    this.on('connection-status', (status) => {
      if (status.quality === 'poor') {
        monitorLogger.warn(`连接质量较差: 成功率 ${status.successRate}%`);
      }
    });

    // 监听自动恢复事件
    this.on('auto-recovery-started', () => {
      monitorLogger.info('自动恢复已启动');
    });

    this.on('auto-recovery-completed', () => {
      monitorLogger.info('自动恢复已完成');
    });

    this.on('auto-recovery-failed', (error) => {
      monitorLogger.error('自动恢复失败', {}, error);
    });
  }

  /**
   * 获取当前监控状态
   */
  getMonitoringStatus(): MonitoringStatus {
    return {
      isMonitoring: this.isMonitoring,
      monitorIntervalMs: this.monitorIntervalMs,
      historySize: this.connectionHistory.length,
      maxHistorySize: this.maxHistorySize
    };
  }
}

/**
 * 连接事件接口
 */
interface ConnectionEvent {
  timestamp: Date;
  isConnected: boolean;
  successRate: number;
  consecutiveFailures: number;
  totalConnections: number;
  lastHealthCheckTime: number;
}

/**
 * 连接统计接口
 */
interface ConnectionStats {
  totalEvents: number;
  connectedEvents: number;
  disconnectedEvents: number;
  averageSuccessRate: number;
  uptime: number;
}

/**
 * 监控状态接口
 */
interface MonitoringStatus {
  isMonitoring: boolean;
  monitorIntervalMs: number;
  historySize: number;
  maxHistorySize: number;
}

// 创建全局连接监控实例
export const connectionMonitor = new ConnectionMonitor();

// 进程退出时清理资源
process.on('exit', () => {
  connectionMonitor.stopMonitoring();
});

process.on('SIGINT', () => {
  connectionMonitor.stopMonitoring();
  process.exit(0);
});

process.on('SIGTERM', () => {
  connectionMonitor.stopMonitoring();
  process.exit(0);
});