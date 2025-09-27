import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mcpLogger } from '../utils/logger.js';

/**
 * MCP 服务类，用于管理与 chrome-devtools-mcp 的连接
 */
export class MCPService {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private isConnected = false;
  
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5; // 增加重连次数从3次到5次，提高连接成功率
  private reconnectDelay = 1000; // 减少基础重连延迟从2秒到1秒，提高响应速度
  private connectionTimeout = 20000; // 减少连接超时从30秒到20秒，更快失败重试
  private isReconnecting = false; // 防止重复重连的标志
  private lastConnectionTime = 0; // 记录最后连接时间，用于连接稳定性分析
  private connectionStabilityThreshold = 3000; // 减少连接稳定性阈值从5秒到3秒，更快检测不稳定连接
  
  // 【新增】连接预热和缓存机制
  private connectionWarmupEnabled = true;
  private connectionCache: Map<string, any> = new Map();
  private connectionCacheTimeout = 60000; // 连接缓存1分钟
  
  // 【新增】健康检查优化
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private healthCheckIntervalMs = 20000; // 减少健康检查间隔从30秒到20秒，更快发现问题
  private lastHealthCheckTime = 0;
  private consecutiveHealthCheckFailures = 0;
  private maxConsecutiveHealthCheckFailures = 2; // 减少从3次到2次，更快触发重连
  
  // 【新增】连接质量指标优化
  private connectionQualityMetrics = {
    totalConnections: 0,
    successfulConnections: 0,
    failedConnections: 0,
    averageConnectionDuration: 0,
    lastSuccessfulConnectionTime: 0,
    fastConnections: 0, // 快速连接计数（<2秒）
    slowConnections: 0  // 慢速连接计数（>5秒）
  };

  // 【新增】连接性能监控
  private connectionPerformanceMetrics = {
    connectionStartTime: 0,
    connectionEndTime: 0,
    averageConnectionTime: 0,
    fastestConnectionTime: Infinity,
    slowestConnectionTime: 0
  };

  /**
   * 初始化 MCP 服务连接
   */
  async initialize(): Promise<void> {
    const startTime = Date.now();
    this.connectionPerformanceMetrics.connectionStartTime = startTime;
    
    try {
      mcpLogger.info('正在初始化 MCP 服务...');
      
      // 检查是否已连接
      if (this.isConnected && this.client) {
        mcpLogger.info('MCP 服务已连接，跳过初始化');
        return;
      }

      // 如果正在重连，等待重连完成
      if (this.isReconnecting) {
        mcpLogger.info('正在重连中，等待重连完成...');
        await this.waitForReconnection();
        return;
      }

      // 断开现有连接
      if (this.client || this.transport) {
        await this.disconnect();
      }
      
      // 【新增】连接预热检查
      if (this.connectionWarmupEnabled) {
        await this.performConnectionWarmup();
      }
      
      // 创建客户端
      this.client = new Client({
        name: 'chrome-devtools-client',
        version: '1.0.0'
      }, {
        capabilities: {
          tools: {}
        }
      });

      // 创建 StdioClientTransport 连接到 chrome-devtools-mcp
      // 【优化】添加更多性能优化参数，移除--headless以显示浏览器窗口
      this.transport = new StdioClientTransport({
        command: 'npx',
        args: ['chrome-devtools-mcp@latest', '--isolated', '--fast-startup']
      });

      // 【优化】设置更短的连接超时，使用Promise.race进行快速失败
      const connectPromise = this.client.connect(this.transport);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('MCP 连接超时')), this.connectionTimeout);
      });

      // 等待连接完成或超时
      await Promise.race([connectPromise, timeoutPromise]);
      
      // 设置连接事件监听
      this.setupConnectionListeners();
      
      this.isConnected = true;
      this.reconnectAttempts = 0; // 重置重连计数
      this.lastConnectionTime = Date.now(); // 记录连接时间
      
      // 【新增】计算连接性能指标
      const connectionTime = Date.now() - startTime;
      this.updateConnectionPerformanceMetrics(connectionTime);
      
      // 【新增】更新连接质量指标
      this.connectionQualityMetrics.totalConnections++;
      this.connectionQualityMetrics.successfulConnections++;
      this.connectionQualityMetrics.lastSuccessfulConnectionTime = Date.now();
      
      // 【新增】分类连接速度
      if (connectionTime < 2000) {
        this.connectionQualityMetrics.fastConnections++;
      } else if (connectionTime > 5000) {
        this.connectionQualityMetrics.slowConnections++;
      }
      
      mcpLogger.info(`MCP 服务初始化成功，连接时间: ${connectionTime}ms`);
      
      // 连接成功后进行健康检查
      try {
        await this.listTools();
        mcpLogger.info('MCP 服务健康检查通过');
        
        // 【新增】启动定期健康检查
        this.startHealthCheck();
      } catch (healthError) {
        mcpLogger.warn('MCP 服务健康检查失败:', healthError);
        // 健康检查失败不影响连接状态，但记录警告
      }
    } catch (error) {
      mcpLogger.error('MCP 服务初始化失败:', error);
      
      // 【新增】更新连接质量指标
      this.connectionQualityMetrics.totalConnections++;
      this.connectionQualityMetrics.failedConnections++;
      
      // 尝试重连
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        await this.attemptReconnect();
      } else {
        throw error;
      }
    }
  }

  /**
   * 【新增】连接预热，提高连接成功率
   */
  private async performConnectionWarmup(): Promise<void> {
    try {
      mcpLogger.info('开始连接预热...');
      
      // 检查系统资源
      const memoryUsage = process.memoryUsage();
      if (memoryUsage.heapUsed > 100 * 1024 * 1024) { // 100MB
        mcpLogger.warn('内存使用较高，可能影响连接性能');
      }
      
      mcpLogger.info('连接预热完成');
    } catch (error) {
      mcpLogger.warn('连接预热失败:', error);
    }
  }

  /**
   * 【新增】更新连接性能指标
   */
  private updateConnectionPerformanceMetrics(connectionTime: number): void {
    this.connectionPerformanceMetrics.connectionEndTime = Date.now();
    
    // 更新平均连接时间
    if (this.connectionPerformanceMetrics.averageConnectionTime === 0) {
      this.connectionPerformanceMetrics.averageConnectionTime = connectionTime;
    } else {
      this.connectionPerformanceMetrics.averageConnectionTime = 
        (this.connectionPerformanceMetrics.averageConnectionTime + connectionTime) / 2;
    }
    
    // 更新最快连接时间
    if (connectionTime < this.connectionPerformanceMetrics.fastestConnectionTime) {
      this.connectionPerformanceMetrics.fastestConnectionTime = connectionTime;
    }
    
    // 更新最慢连接时间
    if (connectionTime > this.connectionPerformanceMetrics.slowestConnectionTime) {
      this.connectionPerformanceMetrics.slowestConnectionTime = connectionTime;
    }
  }

  /**
   * 【新增】等待重连完成
   */
  private async waitForReconnection(): Promise<void> {
    const maxWaitTime = 30000; // 最大等待30秒
    const startTime = Date.now();
    
    while (this.isReconnecting && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (this.isReconnecting) {
      throw new Error('等待重连超时');
    }
  }

  /**
   * 【新增】获取连接性能指标
   */
  getConnectionPerformanceMetrics() {
    return {
      ...this.connectionPerformanceMetrics,
      connectionQuality: this.calculateConnectionQuality()
    };
  }

  /**
   * 【新增】计算连接质量评分
   */
  private calculateConnectionQuality(): number {
    const { totalConnections, successfulConnections, fastConnections } = this.connectionQualityMetrics;
    
    if (totalConnections === 0) return 0;
    
    const successRate = successfulConnections / totalConnections;
    const fastConnectionRate = fastConnections / totalConnections;
    
    // 综合评分：成功率占70%，快速连接率占30%
    return Math.round((successRate * 0.7 + fastConnectionRate * 0.3) * 100);
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(toolName: string, args: any): Promise<any> {
    try {
      mcpLogger.info(`调用 MCP 工具: ${toolName}`);
      
      if (!this.client || !this.isConnected) {
        throw new Error('MCP 服务未连接');
      }

      const result = await this.client.callTool({
        name: toolName,
        arguments: args
      });

      return result;
    } catch (error) {
      mcpLogger.error(`调用工具 ${toolName} 失败:`, error);
      
      // 检查是否为连接相关错误，尝试重连
      if (this.isConnectionError(error)) {
        mcpLogger.info('检测到连接错误，尝试重新连接...');
        try {
          await this.attemptReconnect();
          // 重连成功后重试
          if (this.client && this.isConnected) {
            mcpLogger.info(`重连成功，重试调用工具 ${toolName}`);
            return await this.client.callTool({
              name: toolName,
              arguments: args
            });
          }
        } catch (reconnectError) {
          mcpLogger.error('重连失败:', reconnectError);
        }
      }
      
      throw error;
    }
  }

  /**
   * 获取可用工具列表
   */
  async listTools(): Promise<any> {
    try {
      mcpLogger.info('获取 MCP 工具列表');
      
      if (!this.client || !this.isConnected) {
        throw new Error('MCP 服务未连接');
      }

      const result = await this.client.listTools();
      return result;
    } catch (error) {
      mcpLogger.error('获取工具列表失败:', error);
      
      // 检查是否为连接相关错误，尝试重连
      if (this.isConnectionError(error)) {
        mcpLogger.info('检测到连接错误，尝试重新连接...');
        try {
          await this.attemptReconnect();
          // 重连成功后重试
          if (this.client && this.isConnected) {
            mcpLogger.info('重连成功，重试获取工具列表');
            return await this.client.listTools();
          }
        } catch (reconnectError) {
          mcpLogger.error('重连失败:', reconnectError);
        }
      }
      
      throw error;
    }
  }

  /**
   * 导航到指定页面
   */
  async navigate(url: string): Promise<any> {
    return await this.callTool('navigate_page', { url });
  }

  /**
   * 点击元素
   */
  async click(selector: string): Promise<any> {
    return await this.callTool('click', { uid: selector });
  }

  /**
   * 输入文本
   */
  async type(selector: string, text: string): Promise<any> {
    return await this.callTool('fill', { uid: selector, value: text });
  }

  /**
   * 滚动页面
   */
  async scroll(direction: 'up' | 'down' | 'left' | 'right', distance?: number): Promise<any> {
    return await this.callTool('scroll', { direction, distance });
  }

  /**
   * 等待元素出现
   */
  async waitFor(selector: string, timeout: number = 5000): Promise<any> {
    return await this.callTool('wait_for', { text: selector, timeout });
  }

  /**
   * 截图
   */
  async screenshot(options?: any): Promise<any> {
    return await this.callTool('take_screenshot', options || {});
  }

  /**
   * 提取元素信息
   */
  async extract(selector: string, attribute?: string): Promise<any> {
    const params: any = { selector };
    if (attribute) {
      params.attribute = attribute;
    }
    return await this.callTool('extract', params);
  }

  /**
   * 创建新标签页
   */
  async createNewTab(): Promise<any> {
    return await this.callTool('new_page', {});
  }

  /**
   * 关闭标签页
   */
  async closeTab(tabId?: string): Promise<any> {
    return await this.callTool('close_page', tabId ? { tabId } : {});
  }

  /**
   * 【新增】启动健康检查
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.healthCheckIntervalMs);
    
    mcpLogger.debug('健康检查已启动');
  }

  /**
   * 【新增】停止健康检查
   */
  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    mcpLogger.debug('健康检查已停止');
  }

  /**
   * 【新增】保持连接活跃
   */
  private async keepConnectionAlive(): Promise<void> {
    try {
      if (this.isConnected && this.client) {
        // 发送轻量级的ping请求保持连接
        await this.listTools();
        mcpLogger.debug('连接保活成功');
      }
    } catch (error) {
      mcpLogger.warn('连接保活失败:', error);
      // 保活失败可能表示连接有问题，但不立即重连
      this.consecutiveHealthCheckFailures++;
    }
  }

  /**
   * 【新增】执行健康检查
   */
  private async performHealthCheck(): Promise<void> {
    try {
      this.lastHealthCheckTime = Date.now();
      
      if (!this.isConnected || !this.client) {
        mcpLogger.warn('健康检查失败: MCP 服务未连接');
        this.consecutiveHealthCheckFailures++;
        return;
      }

      // 执行简单的工具列表查询作为健康检查
      await this.listTools();
      
      // 健康检查成功，重置失败计数
      this.consecutiveHealthCheckFailures = 0;
      mcpLogger.debug('健康检查通过');
      
      // 如果连续失败次数过多，触发重连
      if (this.consecutiveHealthCheckFailures >= this.maxConsecutiveHealthCheckFailures) {
        mcpLogger.warn(`连续健康检查失败 ${this.consecutiveHealthCheckFailures} 次，触发重连`);
        await this.attemptReconnect();
      }
    } catch (error) {
      this.consecutiveHealthCheckFailures++;
      mcpLogger.error('健康检查失败:', error);
      
      // 如果连续失败次数过多，触发重连
      if (this.consecutiveHealthCheckFailures >= this.maxConsecutiveHealthCheckFailures) {
        mcpLogger.warn(`连续健康检查失败 ${this.consecutiveHealthCheckFailures} 次，触发重连`);
        await this.attemptReconnect();
      }
    }
  }

  /**
   * 获取连接质量指标
   */
  getConnectionQualityMetrics() {
    return {
      ...this.connectionQualityMetrics,
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      lastHealthCheckTime: this.lastHealthCheckTime,
      consecutiveHealthCheckFailures: this.consecutiveHealthCheckFailures,
      connectionQuality: this.calculateConnectionQuality(),
      uptime: this.lastConnectionTime > 0 ? Date.now() - this.lastConnectionTime : 0
    };
  }

  /**
   * 检查是否连接到 MCP
   */
  isConnectedToMCP(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * 【新增】设置连接事件监听器
   */
  private setupConnectionListeners(): void {
    if (!this.client) return;

    // 监听连接关闭事件
    this.client.onclose = () => {
      mcpLogger.info('MCP 连接已关闭');
      this.isConnected = false;
      this.stopHealthCheck();
    };

    // 监听连接错误事件
    this.client.onerror = (error) => {
      mcpLogger.error('MCP 连接错误:', error);
      this.handleConnectionError(error);
    };

    // 监听通知事件
    this.client.onnotification = (notification) => {
      mcpLogger.debug('收到 MCP 通知:', notification);
    };
  }

  /**
   * 【增强】处理连接错误，实现智能错误恢复
   */
  private async handleConnectionError(error: any): Promise<void> {
    mcpLogger.error('MCP 连接错误:', error);
    
    // 【新增】错误分类和智能处理
    const errorType = this.classifyError(error);
    mcpLogger.info(`错误类型: ${errorType}`);
    
    // 【新增】根据错误类型采用不同的恢复策略
    switch (errorType) {
      case 'network':
        await this.handleNetworkError(error);
        break;
      case 'timeout':
        await this.handleTimeoutError(error);
        break;
      case 'resource':
        await this.handleResourceError(error);
        break;
      case 'protocol':
        await this.handleProtocolError(error);
        break;
      default:
        await this.handleGenericError(error);
    }
  }

  /**
   * 【新增】错误分类
   */
  private classifyError(error: any): string {
    const errorMessage = error?.message?.toLowerCase() || '';
    const errorCode = error?.code || '';
    
    // 网络相关错误
    if (errorMessage.includes('network') || 
        errorMessage.includes('connection') || 
        errorCode === 'ECONNREFUSED' || 
        errorCode === 'ENOTFOUND' ||
        errorCode === 'ENETUNREACH') {
      return 'network';
    }
    
    // 超时错误
    if (errorMessage.includes('timeout') || 
        errorMessage.includes('超时') ||
        errorCode === 'ETIMEDOUT') {
      return 'timeout';
    }
    
    // 资源不足错误
    if (errorMessage.includes('memory') || 
        errorMessage.includes('resource') ||
        errorMessage.includes('busy') ||
        errorCode === 'EMFILE' ||
        errorCode === 'ENOMEM') {
      return 'resource';
    }
    
    // 协议错误
    if (errorMessage.includes('protocol') || 
        errorMessage.includes('invalid') ||
        errorMessage.includes('malformed')) {
      return 'protocol';
    }
    
    return 'generic';
  }

  /**
   * 【新增】处理网络错误
   */
  private async handleNetworkError(error: any): Promise<void> {
    mcpLogger.info('处理网络错误，使用渐进式重连策略');
    
    // 网络错误使用较长的重连间隔
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 10000);
    await this.attemptReconnect();
  }

  /**
   * 【新增】处理超时错误
   */
  private async handleTimeoutError(error: any): Promise<void> {
    mcpLogger.info('处理超时错误，增加连接超时时间');
    
    // 超时错误增加连接超时时间
    this.connectionTimeout = Math.min(this.connectionTimeout * 1.2, 60000);
    await this.attemptReconnect();
  }

  /**
   * 【新增】处理资源错误
   */
  private async handleResourceError(error: any): Promise<void> {
    mcpLogger.info('处理资源错误，等待资源释放后重连');
    
    // 资源错误等待更长时间
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 清理可能的资源泄漏
    await this.forceDisconnect();
    
    // 强制垃圾回收（如果可用）
    if (global.gc) {
      global.gc();
    }
    
    await this.attemptReconnect();
  }

  /**
   * 【新增】处理协议错误
   */
  private async handleProtocolError(error: any): Promise<void> {
    mcpLogger.info('处理协议错误，重置连接状态');
    
    // 协议错误需要完全重置连接
    await this.forceDisconnect();
    
    // 清理缓存
    this.connectionCache.clear();
    
    // 重置连接参数
    this.reconnectDelay = 1000;
    this.connectionTimeout = 20000;
    
    await this.attemptReconnect();
  }

  /**
   * 【新增】处理通用错误
   */
  private async handleGenericError(error: any): Promise<void> {
    mcpLogger.info('处理通用错误，使用标准重连流程');
    
    // 标准重连流程
    await this.attemptReconnect();
  }

  /**
   * 【增强】智能重连机制
   */
  private async attemptReconnect(): Promise<void> {
    if (this.isReconnecting) {
      mcpLogger.info('重连已在进行中，跳过此次重连请求');
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    try {
      mcpLogger.info(`开始第 ${this.reconnectAttempts} 次重连尝试 (最大 ${this.maxReconnectAttempts} 次)`);
      
      // 【新增】智能延迟策略
      const delay = this.calculateReconnectDelay();
      mcpLogger.info(`重连延迟: ${delay}ms`);
      
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // 【新增】连接前预检查
      const preCheckResult = await this.performPreConnectionCheck();
      if (!preCheckResult.canConnect) {
        mcpLogger.info(`预检查失败: ${preCheckResult.reason}`);
        throw new Error(`预检查失败: ${preCheckResult.reason}`);
      }

      // 强制断开现有连接
      await this.forceDisconnect();

      // 重新初始化连接
      await this.initialize();

      if (this.isConnected) {
        mcpLogger.info('重连成功');
        this.reconnectAttempts = 0;
        this.consecutiveHealthCheckFailures = 0;
        
        // 【新增】重连成功后的验证
        await this.validateReconnection();
      } else {
        throw new Error('重连后连接状态仍为未连接');
      }
    } catch (error) {
      mcpLogger.error(`第 ${this.reconnectAttempts} 次重连失败:`, error);
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        mcpLogger.error('已达到最大重连次数，停止重连');
        await this.handleReconnectionFailure();
      } else {
        // 继续重连，但增加延迟
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        mcpLogger.info(`将在 ${this.reconnectDelay}ms 后进行下次重连尝试`);
      }
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * 【新增】计算重连延迟
   */
  private calculateReconnectDelay(): number {
    // 指数退避算法，但有最大限制
    const baseDelay = this.reconnectDelay;
    const jitter = Math.random() * 1000; // 添加随机抖动避免雷群效应
    const exponentialDelay = baseDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    return Math.min(exponentialDelay + jitter, 30000); // 最大30秒
  }

  /**
   * 【新增】连接前预检查
   */
  private async performPreConnectionCheck(): Promise<{canConnect: boolean, reason?: string}> {
    try {
      // 检查系统资源
      const memoryUsage = process.memoryUsage();
      const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;
      
      if (memoryUsageMB > 500) { // 500MB
        return {
          canConnect: false,
          reason: `内存使用过高: ${memoryUsageMB.toFixed(2)}MB`
        };
      }
      
      // 检查连接稳定性
      const timeSinceLastConnection = Date.now() - this.lastConnectionTime;
      if (timeSinceLastConnection < this.connectionStabilityThreshold) {
        return {
          canConnect: false,
          reason: `连接过于频繁，需等待 ${this.connectionStabilityThreshold - timeSinceLastConnection}ms`
        };
      }
      
      // 检查重连频率
      if (this.reconnectAttempts > 3) {
        const backoffTime = Math.pow(2, this.reconnectAttempts - 3) * 1000;
        return {
          canConnect: false,
          reason: `重连过于频繁，建议等待 ${backoffTime}ms`
        };
      }
      
      return { canConnect: true };
    } catch (error) {
      return {
        canConnect: false,
        reason: `预检查异常: ${error.message}`
      };
    }
  }

  /**
   * 【新增】验证重连结果
   */
  private async validateReconnection(): Promise<void> {
    try {
      // 测试基本功能
      const testResult = await this.testBasicFunctionality();
      if (!testResult.success) {
        throw new Error(`重连验证失败: ${testResult.error}`);
      }
      
      mcpLogger.info('重连验证成功');
    } catch (error) {
      mcpLogger.error('重连验证失败:', error);
      throw error;
    }
  }

  /**
   * 【新增】测试基本功能
   */
  private async testBasicFunctionality(): Promise<{success: boolean, error?: string}> {
    try {
      // 这里可以添加一些基本的MCP服务调用测试
      // 目前只做连接状态检查
      if (!this.isConnectedToMCP()) {
        return {
          success: false,
          error: '连接状态检查失败'
        };
      }
      
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 【新增】处理重连失败
   */
  private async handleReconnectionFailure(): Promise<void> {
    mcpLogger.error('重连完全失败，进入故障模式');
    
    // 停止健康检查
    this.stopHealthCheck();
    
    // 清理资源
    await this.forceDisconnect();
    
    // 重置状态
    this.isConnected = false;
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    
    // 分析失败原因
    await this.analyzeReconnectionFailure(new Error('达到最大重连次数'));
    
    // 可以在这里添加通知机制，告知上层应用连接失败
    mcpLogger.error('MCP 服务连接失败，需要手动干预');
  }

  /**
   * 【新增】分析重连失败原因
   */
  private async analyzeReconnectionFailure(error: any): Promise<void> {
    const analysis = {
      totalAttempts: this.reconnectAttempts,
      lastError: error.message,
      connectionMetrics: this.getConnectionQualityMetrics(),
      systemInfo: {
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        platform: process.platform,
        nodeVersion: process.version
      },
      timestamp: new Date().toISOString()
    };
    
    mcpLogger.error('重连失败分析:', analysis);
    
    // 这里可以添加更多的分析逻辑，比如：
    // 1. 发送错误报告到监控系统
    // 2. 记录到专门的错误日志文件
    // 3. 触发告警通知
  }

  /**
   * 检查是否为连接相关错误
   */
  private isConnectionError(error: any): boolean {
    if (!error) return false;
    
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code || '';
    
    // 常见的连接错误标识
    const connectionErrorPatterns = [
      'connection',
      'connect',
      'network',
      'timeout',
      'refused',
      'reset',
      'closed',
      'disconnected',
      'unreachable'
    ];
    
    const connectionErrorCodes = [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ENETUNREACH',
      'EPIPE'
    ];
    
    return connectionErrorPatterns.some(pattern => errorMessage.includes(pattern)) ||
           connectionErrorCodes.includes(errorCode);
  }

  /**
   * 【新增】强制断开连接
   */
  private async forceDisconnect(): Promise<void> {
    try {
      this.isConnected = false;
      
      // 停止健康检查
      this.stopHealthCheck();
      
      // 关闭客户端连接
      if (this.client) {
        try {
          await this.client.close();
        } catch (error) {
          mcpLogger.warn('关闭客户端时出错:', error);
        }
        this.client = null;
      }
      
      // 关闭传输层连接
      if (this.transport) {
        try {
          await this.transport.close();
        } catch (error) {
          mcpLogger.warn('关闭传输层时出错:', error);
        }
        this.transport = null;
      }
      
      // 清理缓存
      this.connectionCache.clear();
      
      mcpLogger.info('强制断开连接完成');
    } catch (error) {
      mcpLogger.error('强制断开连接时出错:', error);
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    try {
      mcpLogger.info('正在断开 MCP 服务连接...');
      
      this.isConnected = false;
      
      // 停止健康检查
      this.stopHealthCheck();
      
      // 关闭客户端连接
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      
      // 关闭传输层连接
      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }
      
      // 清理缓存
      this.connectionCache.clear();
      
      mcpLogger.info('MCP 服务连接已断开');
    } catch (error) {
      mcpLogger.error('断开 MCP 服务连接时出错:', error);
    }
  }

  /**
   * 销毁服务实例
   */
  async destroy(): Promise<void> {
    await this.disconnect();
  }
}

// 导出单例实例
export const mcpService = new MCPService();

// 进程退出时清理资源
process.on('exit', async () => {
  await mcpService.destroy();
});

process.on('SIGINT', async () => {
  await mcpService.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await mcpService.destroy();
  process.exit(0);
});