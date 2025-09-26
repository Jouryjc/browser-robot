/**
 * 浏览器自动化服务
 * 使用 MCP 协议和 chrome-devtools-mcp 执行浏览器操作
 */

import { TaskStep } from '../types/task.js';
import { mcpService } from './mcp-service.js';

/**
 * 浏览器操作结果接口
 */
export interface BrowserActionResult {
  success: boolean;
  message: string;
  data?: any;
  screenshot?: string;
  error?: string;
}

/**
 * 浏览器标签页信息
 */
export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

/**
 * 浏览器自动化服务类，使用 MCP 服务进行浏览器自动化操作
 */
export class BrowserService {
  private currentPageId: string | null = null;
  private connectionRetryCount = 0;
  private maxConnectionRetries = 3;
  private connectionTimeout = 15000; // 15秒连接超时
  private lastConnectionTime: number = 0;
  private connectionCooldown = 5000; // 5秒连接冷却时间

  /**
   * 连接到浏览器服务（增强版）
   */
  async connect(): Promise<void> {
    const now = Date.now();
    
    // 检查连接冷却时间
    if (now - this.lastConnectionTime < this.connectionCooldown) {
      console.log('连接冷却中，跳过重复连接请求');
      return;
    }
    
    try {
      console.log('正在连接浏览器服务...');
      
      // 设置连接超时
      const connectPromise = mcpService.initialize();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('浏览器服务连接超时')), this.connectionTimeout);
      });
      
      // 等待连接完成或超时
      await Promise.race([connectPromise, timeoutPromise]);
      
      // 连接成功后进行验证
      const isHealthy = await this.healthCheck();
      if (!isHealthy) {
        throw new Error('浏览器服务连接后健康检查失败');
      }
      
      this.lastConnectionTime = now;
      this.connectionRetryCount = 0; // 重置重试计数
      
      console.log('浏览器服务连接成功并通过健康检查');
    } catch (error) {
      console.error('连接浏览器失败:', error);
      
      // 连接失败时清理状态
      this.currentPageId = null;
      this.resetConnectionState();
      
      // 尝试重连
      if (this.connectionRetryCount < this.maxConnectionRetries) {
        this.connectionRetryCount++;
        console.log(`尝试第 ${this.connectionRetryCount} 次重连浏览器服务...`);
        
        // 等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 2000 * this.connectionRetryCount));
        return await this.connect();
      }
      
      throw error;
    }
  }

  /**
   * 调用 MCP 工具的通用方法
   */
  private async callTool(toolName: string, args: any = {}): Promise<any> {
    try {
      // 检查连接状态
      if (!this.isConnectedToMCP()) {
        console.log('MCP 服务未连接，尝试重新连接...');
        await this.connect();
      }
      
      return await mcpService.callTool(toolName, args);
    } catch (error) {
      console.error(`调用 MCP 工具 ${toolName} 失败:`, error);
      
      // 如果是连接相关错误，尝试重连
      if (this.isConnectionError(error)) {
        console.log('检测到连接错误，尝试重新连接...');
        await this.connect();
        
        // 重连后重试一次
        try {
          return await mcpService.callTool(toolName, args);
        } catch (retryError) {
          console.error(`重试调用 MCP 工具 ${toolName} 仍然失败:`, retryError);
          throw retryError;
        }
      }
      
      throw error;
    }
  }

  /**
   * 检查连接状态
   */
  isConnectedToMCP(): boolean {
    return mcpService.isConnectedToMCP();
  }

  /**
   * 获取MCP服务实例
   */
  getMCPService() {
    return mcpService;
  }

  /**
   * 获取可用的浏览器标签页
   */
  async getAvailableTabs(): Promise<BrowserTab[]> {
    try {
      // 这里应该调用Chrome DevTools API获取标签页列表
      // 暂时返回模拟数据
      return [
        {
          id: 'tab-1',
          url: 'about:blank',
          title: '新标签页',
          webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/tab-1'
        }
      ];
    } catch (error) {
      console.error('获取浏览器标签页失败:', error);
      return [];
    }
  }

  /**
   * 创建新标签页
   */
  async createNewTab(): Promise<string> {
    try {
      const result = await this.callTool('new_page', {
        url: 'about:blank'
      });
      this.currentPageId = result.pageId || result.id || 'default-page';
      console.log(`已创建新标签页: ${this.currentPageId}`);
      return this.currentPageId;
    } catch (error) {
      console.error('创建新标签页失败:', error);
      throw error;
    }
  }

  /**
   * 执行单个操作步骤
   * @param step 操作步骤
   */
  async executeStep(step: TaskStep): Promise<BrowserActionResult> {
    try {
      switch (step.action) {
        case 'navigate':
          return await this.navigate(step.parameters.url);
        case 'click':
          return await this.click(step.parameters);
        case 'type':
          return await this.type(step.parameters);
        case 'scroll':
          return await this.scroll(step.parameters);
        case 'wait':
          return await this.wait(step.parameters);
        case 'screenshot':
          return await this.takeScreenshot();
        case 'extract':
          return await this.extractData(step.parameters);
        default:
          return {
            success: false,
            message: `不支持的操作类型: ${step.action}`,
            error: 'UNSUPPORTED_ACTION'
          };
      }
    } catch (error) {
      console.error(`执行步骤失败 [${step.action}]:`, error);
      return {
        success: false,
        message: `执行步骤失败: ${error instanceof Error ? error.message : '未知错误'}`,
        error: 'EXECUTION_ERROR'
      };
    }
  }

  /**
   * 导航到指定URL
   * @param url 目标URL
   */
  private async navigate(url: string): Promise<BrowserActionResult> {
    try {
      // 如果没有当前页面ID，先创建一个新页面
      if (!this.currentPageId) {
        await this.createNewTab();
      }
      
      await this.callTool('navigate_page', {
        url: url
      });
      
      return {
        success: true,
        message: `成功导航到 ${url}`
      };
    } catch (error) {
      return {
        success: false,
        message: `导航失败: ${error instanceof Error ? error.message : '未知错误'}`,
        error: 'NAVIGATION_ERROR'
      };
    }
  }

  /**
   * 等待页面元素或条件
   * @param condition 等待条件
   * @param timeout 超时时间（毫秒）
   */
  async waitFor(condition: string, timeout: number = 5000): Promise<void> {
    try {
      await this.callTool('wait_for', {
        selector: condition,
        timeout: timeout
      });
      
      console.log(`等待条件满足: ${condition}`);
    } catch (error) {
      console.error('等待超时:', error);
      throw error;
    }
  }

  /**
   * 点击元素
   * @param params 点击参数
   */
  private async click(params: { selector?: string; x?: number; y?: number; text?: string }): Promise<BrowserActionResult> {
    try {
      let clickArgs: any = {};
      
      if (params.x !== undefined && params.y !== undefined) {
        // 使用坐标点击
        clickArgs = {
          x: params.x,
          y: params.y
        };
        // 使用evaluate_script实现坐标点击
        const clickScript = `document.elementFromPoint(${params.x}, ${params.y})?.click()`;
        await this.callTool('evaluate_script', { script: clickScript });
      } else if (params.selector) {
        // 使用选择器点击
        clickArgs.selector = params.selector;
        await this.callTool('click', clickArgs);
      } else if (params.text) {
        // 使用文本点击
        clickArgs.text = params.text;
        // 使用evaluate_script实现文本点击
        const clickTextScript = `Array.from(document.querySelectorAll('*')).find(el => el.textContent?.includes('${params.text}'))?.click()`;
        await this.callTool('evaluate_script', { script: clickTextScript });
      } else {
        throw new Error('必须提供坐标、选择器或文本');
      }
      
      return {
        success: true,
        message: `已点击元素: ${JSON.stringify(params)}`
      };
    } catch (error) {
      return {
        success: false,
        message: `点击失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 输入文本
   * @param params 输入参数
   */
  private async type(params: { selector?: string; text: string; clear?: boolean }): Promise<BrowserActionResult> {
    try {
      const typeArgs: any = {
        text: params.text
      };
      
      if (params.selector) {
        typeArgs.selector = params.selector;
      }
      
      if (params.clear) {
        typeArgs.clear = true;
      }
      
      // 调用 MCP 输入工具
      await this.callTool('fill', typeArgs);
      
      return {
        success: true,
        message: `已输入文本: ${params.text}`
      };
    } catch (error) {
      return {
        success: false,
        message: `输入失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 滚动页面
   * @param params 滚动参数
   */
  private async scroll(params: { direction: 'up' | 'down' | 'left' | 'right'; distance?: number; selector?: string }): Promise<BrowserActionResult> {
    try {
      const scrollArgs: any = {
        direction: params.direction,
        distance: params.distance || 300
      };
      
      if (params.selector) {
        scrollArgs.selector = params.selector;
      }
      
      // 使用evaluate_script实现滚动
      const scrollScript = `window.scrollBy(${params.direction === 'left' ? -(params.distance || 300) : params.direction === 'right' ? (params.distance || 300) : 0}, ${params.direction === 'up' ? -(params.distance || 300) : params.direction === 'down' ? (params.distance || 300) : 0})`;
      await this.callTool('evaluate_script', { script: scrollScript });
      
      return {
        success: true,
        message: `已滚动 ${params.direction} ${params.distance || 300}px`
      };
    } catch (error) {
      return {
        success: false,
        message: `滚动失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 等待操作
   * @param params 等待参数
   */
  private async wait(params: any): Promise<BrowserActionResult> {
    try {
      if (params.selector) {
        // 等待元素出现
        const startTime = Date.now();
        const timeout = params.timeout || 10000;
        
        while (Date.now() - startTime < timeout) {
          const element = await this.findElement(params.selector);
          if (element) {
            return {
              success: true,
              message: `元素 ${params.selector} 已出现`
            };
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        return {
          success: false,
          message: `等待元素超时: ${params.selector}`,
          error: 'WAIT_TIMEOUT'
        };
      } else if (params.time) {
        // 等待指定时间
        await new Promise(resolve => setTimeout(resolve, params.time));
        return {
          success: true,
          message: `等待 ${params.time}ms 完成`
        };
      }
      
      return {
        success: false,
        message: '无效的等待参数',
        error: 'INVALID_WAIT_PARAMS'
      };
    } catch (error) {
      return {
        success: false,
        message: `等待操作失败: ${error instanceof Error ? error.message : '未知错误'}`,
        error: 'WAIT_ERROR'
      };
    }
  }

  /**
   * 截图
   * @param params 截图参数
   */
  private async takeScreenshot(params: { fullPage?: boolean; selector?: string } = {}): Promise<BrowserActionResult> {
    try {
      const screenshotArgs: any = {};
      
      if (params.fullPage) {
        screenshotArgs.fullPage = true;
      }
      
      if (params.selector) {
        screenshotArgs.selector = params.selector;
      }
      
      // 调用 MCP 截图工具
      const result = await this.callTool('take_screenshot', screenshotArgs);
      
      return {
        success: true,
        message: '截图成功',
        data: result,
        screenshot: result.screenshot || result.data
      };
    } catch (error) {
      return {
        success: false,
        message: `截图失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 提取数据
   * @param params 提取参数
   */
  private async extractData(params: any): Promise<BrowserActionResult> {
    try {
      const extractArgs: any = {
        selector: params.selector
      };
      
      if (params.attribute) {
        extractArgs.attribute = params.attribute;
      }
      
      if (params.multiple) {
        extractArgs.multiple = true;
      }
      
      // 使用evaluate_script实现数据提取
      const extractScript = params.attribute 
        ? `document.querySelector('${params.selector}')?.getAttribute('${params.attribute}')`
        : `document.querySelector('${params.selector}')?.textContent`;
      const result = await this.callTool('evaluate_script', { script: extractScript });
      
      return {
        success: true,
        message: params.multiple ? `提取了多个元素的数据` : '数据提取成功',
        data: result
      };
    } catch (error) {
      return {
        success: false,
        message: `数据提取失败: ${error instanceof Error ? error.message : '未知错误'}`,
        error: 'EXTRACT_ERROR'
      };
    }
  }

  /**
   * 查找页面元素
   * @param selector CSS选择器
   */
  private async findElement(selector: string): Promise<any> {
    try {
      // 使用evaluate_script实现元素查找
      const findScript = `document.querySelector('${selector}') ? true : false`;
      const result = await this.callTool('evaluate_script', { script: findScript });
      
      return result;
    } catch (error) {
      console.error('查找元素失败:', error);
      return null;
    }
  }

  /**
   * 发送Chrome DevTools命令（通过MCP）
   * @param method 命令方法
   * @param params 命令参数
   */
  private async sendCommand(method: string, params: any = {}): Promise<any> {
    try {
      // 根据MCP工具列表，没有send_devtools_command工具，使用evaluate_script替代
      const commandScript = `console.log('DevTools命令: ${method}', ${JSON.stringify(params)})`;
      return await this.callTool('evaluate_script', { script: commandScript });
    } catch (error) {
      console.error(`发送命令 ${method} 失败:`, error);
      throw error;
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
      'transport',
      '未连接',
      'not connected'
    ];
    
    return connectionErrorPatterns.some(pattern => 
      errorMessage.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * 【核心修复】健康检查（增强版）
   * 这是确保浏览器服务连接稳定性的关键方法
   * 通过多层检查确保MCP连接、工具可用性和页面状态都正常
   */
  async healthCheck(): Promise<boolean> {
    try {
      // 【第一层检查】MCP服务连接状态
      if (!this.isConnectedToMCP()) {
        console.warn('健康检查: MCP服务未连接');
        return false;
      }
      
      // 【第二层检查】尝试列出工具来验证连接可用性
      // 这能检测到连接存在但无法正常通信的情况
      const tools = await mcpService.listTools();
      if (!tools || tools.length === 0) {
        console.warn('健康检查: 无法获取MCP工具列表');
        return false;
      }
      
      // 【第三层检查】检查当前页面状态（如果有的话）
      // 确保浏览器页面仍然有效，避免操作失效的页面
      if (this.currentPageId) {
        try {
          // 尝试获取页面信息来验证页面是否仍然有效
          await mcpService.callTool('get_page_info', {});
        } catch (pageError) {
          console.warn('健康检查: 当前页面可能已失效:', pageError);
          this.currentPageId = null; // 清除无效的页面ID
        }
      }
      
      console.log('健康检查通过');
      return true;
    } catch (error) {
      console.error('健康检查失败:', error);
      return false;
    }
  }

  /**
   * 获取连接状态信息
   */
  getConnectionStatus(): {
    connected: boolean;
    retryCount: number;
    lastConnectionTime: number;
    currentPageId: string | null;
  } {
    return {
      connected: this.isConnectedToMCP(),
      retryCount: this.connectionRetryCount,
      lastConnectionTime: this.lastConnectionTime,
      currentPageId: this.currentPageId
    };
  }

  /**
   * 重置连接状态
   */
  resetConnectionState(): void {
    this.connectionRetryCount = 0;
    this.lastConnectionTime = 0;
    this.currentPageId = null;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    try {
      console.log('正在断开浏览器服务连接...');
      
      // 清理当前页面状态
      this.currentPageId = null;
      
      // 断开 MCP 服务连接
      await mcpService.disconnect();
      
      // 重置连接状态
      this.resetConnectionState();
      
      console.log('浏览器服务已断开连接');
    } catch (error) {
      console.error('断开连接时出错:', error);
      
      // 即使出错也要重置状态
      this.resetConnectionState();
    }
  }
}

// 导出单例实例
export const browserService = new BrowserService();