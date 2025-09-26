import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * MCP 服务类，用于管理与 chrome-devtools-mcp 的连接
 */
export class MCPService {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private isConnected = false;
  // 【连接管理优化】重连机制参数配置
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5; // 增加重连次数从3次到5次，提高连接成功率
  private reconnectDelay = 2000; // 基础重连延迟2秒
  private connectionTimeout = 30000; // 连接超时30秒
  private isReconnecting = false; // 防止重复重连的标志
  private lastConnectionTime = 0; // 记录最后连接时间，用于连接稳定性分析
  private connectionStabilityThreshold = 5000; // 连接稳定性阈值（5秒），低于此时间认为连接不稳定

  /**
   * 初始化 MCP 客户端连接
   */
  async initialize(): Promise<void> {
    if (this.isReconnecting) {
      console.log('MCP 服务正在重连中，跳过初始化请求');
      return;
    }

    try {
      console.log('正在初始化 MCP 服务...');
      
      // 如果已经连接，先断开
      if (this.isConnected) {
        await this.disconnect();
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
      // 让 chrome-devtools-mcp 自动管理浏览器实例，使用 headless 和 isolated 模式
      this.transport = new StdioClientTransport({
        command: 'npx',
        args: ['chrome-devtools-mcp@latest', '--headless', '--isolated']
      });

      // 设置连接超时
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
      
      console.log('MCP 服务初始化成功');
      
      // 连接成功后进行健康检查
      try {
        await this.listTools();
        console.log('MCP 服务健康检查通过');
      } catch (healthError) {
        console.warn('MCP 服务健康检查失败:', healthError);
        // 健康检查失败不影响连接状态，但记录警告
      }
    } catch (error) {
      console.error('MCP 服务初始化失败:', error);
      
      // 尝试重连
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        await this.attemptReconnect();
      } else {
        throw error;
      }
    }
  }

  /**
   * 调用 MCP 工具
   * @param toolName 工具名称
   * @param args 工具参数
   */
  async callTool(toolName: string, args: any): Promise<any> {
    // 检查连接状态，如果未连接则尝试重连
    if (!this.client || !this.isConnected) {
      console.log('MCP 客户端未连接，尝试重新初始化...');
      await this.initialize();
    }
    
    try {
      const result = await this.client!.callTool({
        name: toolName,
        arguments: args
      });
      
      return result;
    } catch (error) {
      console.error(`调用 MCP 工具 ${toolName} 失败:`, error);
      
      // 如果是连接错误，尝试重连
      if (this.isConnectionError(error)) {
        console.log('检测到连接错误，尝试重连...');
        await this.attemptReconnect();
        
        // 重连后重试工具调用
        if (this.isConnected) {
          return await this.client!.callTool({
            name: toolName,
            arguments: args
          });
        }
      }
      
      throw error;
    }
  }

  /**
   * 获取可用的工具列表
   */
  async listTools(): Promise<any> {
    // 检查连接状态，如果未连接则尝试重连
    if (!this.client || !this.isConnected) {
      console.log('MCP 客户端未连接，尝试重新初始化...');
      await this.initialize();
    }

    try {
      const result = await this.client!.listTools();
      return result;
    } catch (error) {
      console.error('获取工具列表失败:', error);
      
      // 如果是连接错误，尝试重连
      if (this.isConnectionError(error)) {
        await this.attemptReconnect();
        if (this.isConnected) {
          return await this.client!.listTools();
        }
      }
      
      throw error;
    }
  }

  /**
   * 导航到指定 URL
   * @param url 目标 URL
   */
  async navigate(url: string): Promise<any> {
    return this.callTool('navigate_page', { url });
  }

  /**
   * 点击元素
   * @param selector CSS 选择器
   */
  async click(selector: string): Promise<any> {
    return this.callTool('click', { selector });
  }

  /**
   * 输入文本
   * @param selector CSS 选择器
   * @param text 要输入的文本
   */
  async type(selector: string, text: string): Promise<any> {
    return this.callTool('fill', { selector, text });
  }

  /**
   * 滚动页面
   * @param direction 滚动方向
   * @param distance 滚动距离
   */
  async scroll(direction: 'up' | 'down' | 'left' | 'right', distance?: number): Promise<any> {
    // 根据MCP工具列表，没有scroll工具，使用evaluate_script来实现滚动
    const scrollScript = `window.scrollBy(${direction === 'left' ? -(distance || 100) : direction === 'right' ? (distance || 100) : 0}, ${direction === 'up' ? -(distance || 100) : direction === 'down' ? (distance || 100) : 0})`;
    return this.callTool('evaluate_script', { script: scrollScript });
  }

  /**
   * 等待元素出现
   * @param selector CSS 选择器
   * @param timeout 超时时间（毫秒）
   */
  async waitFor(selector: string, timeout: number = 5000): Promise<any> {
    return this.callTool('wait_for', { selector, timeout });
  }

  /**
   * 截图
   * @param options 截图选项
   */
  async screenshot(options?: any): Promise<any> {
    return this.callTool('take_screenshot', options || {});
  }

  /**
   * 提取页面数据
   * @param selector CSS 选择器
   * @param attribute 要提取的属性
   */
  async extract(selector: string, attribute?: string): Promise<any> {
    // 根据MCP工具列表，没有extract工具，使用evaluate_script来实现数据提取
    const extractScript = attribute 
      ? `document.querySelector('${selector}')?.getAttribute('${attribute}')`
      : `document.querySelector('${selector}')?.textContent`;
    return this.callTool('evaluate_script', { script: extractScript });
  }

  /**
   * 创建新标签页
   */
  async createNewTab(): Promise<any> {
    return this.callTool('new_page', {
      url: 'about:blank'
    });
  }

  /**
   * 关闭标签页
   * @param tabId 标签页 ID
   */
  async closeTab(tabId?: string): Promise<any> {
    return this.callTool('close_page', { tabId });
  }

  /**
   * 检查连接状态
   */
  isConnectedToMCP(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * 设置连接事件监听器
   */
  private setupConnectionListeners(): void {
    if (!this.client || !this.transport) return;

    // 监听客户端错误事件
    this.client.onerror = (error) => {
      console.error('MCP 客户端错误:', error);
      this.handleConnectionError(error);
    };

    // 监听客户端关闭事件
    this.client.onclose = () => {
      console.log('MCP 连接已关闭');
      this.isConnected = false;
      
      // 检查连接持续时间，如果连接时间太短可能存在问题
      const connectionDuration = Date.now() - this.lastConnectionTime;
      if (connectionDuration < this.connectionStabilityThreshold) {
        console.warn(`MCP 连接持续时间过短 (${connectionDuration}ms)，可能存在稳定性问题`);
      }
      
      if (!this.isReconnecting) {
        this.attemptReconnect();
      }
    };

    // 监听传输层错误事件
    if (this.transport.process) {
      this.transport.process.on('error', (error) => {
        console.error('MCP 传输层错误:', error);
        this.handleConnectionError(error);
      });

      this.transport.process.on('exit', (code, signal) => {
        console.log(`MCP 进程退出: code=${code}, signal=${signal}`);
        this.isConnected = false;
        
        // 如果不是正常退出，尝试重连
        if (code !== 0 && !this.isReconnecting) {
          this.handleConnectionError(new Error(`MCP 进程异常退出: ${code}`));
        }
      });

      this.transport.process.on('close', (code, signal) => {
        console.log(`MCP 进程关闭: code=${code}, signal=${signal}`);
        this.isConnected = false;
      });
    }
  }

  /**
   * 处理连接错误
   */
  private async handleConnectionError(error: any): Promise<void> {
    console.error('处理 MCP 连接错误:', error);
    this.isConnected = false;
    
    // 避免重复重连
    if (!this.isReconnecting && this.reconnectAttempts < this.maxReconnectAttempts) {
      await this.attemptReconnect();
    }
  }

  /**
   * 【核心修复】尝试重新连接（使用指数退避策略）
   * 这是解决MCP服务连接不稳定问题的关键方法
   * 采用指数退避算法，避免频繁重连对服务造成压力
   */
  private async attemptReconnect(): Promise<void> {
    if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    // 【指数退避算法】每次重连延迟时间翻倍，避免频繁重连
    // 第1次：2秒，第2次：4秒，第3次：8秒，第4次：16秒，第5次：30秒（上限）
    const currentDelay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    const maxDelay = 30000; // 最大延迟30秒
    const actualDelay = Math.min(currentDelay, maxDelay);

    console.log(`尝试重新连接 MCP 服务 (${this.reconnectAttempts}/${this.maxReconnectAttempts})，延迟 ${actualDelay}ms`);

    try {
      await new Promise(resolve => setTimeout(resolve, actualDelay));
      
      // 【连接清理】重连前先清理旧连接，避免资源泄漏
      if (this.client) {
        try {
          await this.client.close();
        } catch (closeError) {
          console.warn('关闭旧连接时出错:', closeError);
        }
      }
      
      await this.initialize();
      console.log('MCP 服务重连成功');
      
      // 重连成功后重置重连计数
      this.reconnectAttempts = 0;
    } catch (error) {
      console.error(`MCP 服务重连失败 (${this.reconnectAttempts}/${this.maxReconnectAttempts}):`, error);
      
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('MCP 服务重连次数已达上限，停止重连');
        this.isConnected = false;
      } else {
        // 如果还有重连机会，继续尝试（延迟1秒避免立即重连）
        setTimeout(() => this.attemptReconnect(), 1000);
      }
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * 判断是否为连接错误
   */
  private isConnectionError(error: any): boolean {
    if (!error) return false;
    
    const errorMessage = error.message || error.toString();
    const connectionErrorPatterns = [
      'connection',
      'disconnect',
      'timeout',
      'ECONNRESET',
      'EPIPE',
      'socket',
      'transport'
    ];
    
    return connectionErrorPatterns.some(pattern => 
      errorMessage.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * 强制断开连接（不抛出错误）
   */
  private async forceDisconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
      }
    } catch (error) {
      console.warn('强制关闭客户端时出错:', error);
    }
    
    try {
      if (this.transport) {
        await this.transport.close();
      }
    } catch (error) {
      console.warn('强制关闭传输层时出错:', error);
    }
    
    // 如果进程仍在运行，强制终止
    if (this.transport?.process && !this.transport.process.killed) {
      try {
        this.transport.process.kill('SIGTERM');
        
        // 等待一段时间后强制杀死
        setTimeout(() => {
          if (this.transport?.process && !this.transport.process.killed) {
            this.transport.process.kill('SIGKILL');
          }
        }, 5000);
      } catch (error) {
        console.warn('强制终止进程时出错:', error);
      }
    }
    
    this.client = null;
    this.transport = null;
    this.isConnected = false;
  }

  /**
   * 断开 MCP 连接
   */
  async disconnect(): Promise<void> {
    try {
      console.log('正在断开 MCP 连接...');
      
      if (this.client && this.isConnected) {
        await this.client.close();
      }
      
      if (this.transport) {
        await this.transport.close();
      }
      
      this.client = null;
      this.transport = null;
      this.isConnected = false;
      
      console.log('MCP 服务已断开连接');
    } catch (error) {
      console.error('断开 MCP 连接时出错:', error);
      // 即使出错也要重置状态
      this.client = null;
      this.transport = null;
      this.isConnected = false;
    }
  }

  /**
   * 析构函数 - 确保资源清理
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