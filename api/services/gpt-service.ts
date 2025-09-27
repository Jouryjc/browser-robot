/**
 * GPT-4自然语言处理服务
 * 负责将用户的自然语言指令解析为具体的浏览器操作步骤
 * 使用 MCP 服务进行浏览器自动化
 */

import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { mcpService } from './mcp-service.js';
import { gptLogger } from '../utils/logger.js';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 初始化DeepSeek客户端
let deepseekClient: OpenAI | null = null;

// 延迟初始化 DeepSeek 客户端
function getDeepSeekClient(): OpenAI {
  if (!deepseekClient) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey || apiKey === 'your_deepseek_api_key_here') {
      throw new Error('请在 .env 文件中设置有效的 DEEPSEEK_API_KEY');
    }
    deepseekClient = new OpenAI({ 
      apiKey,
      baseURL: 'https://api.deepseek.com/v1'
    });
  }
  return deepseekClient;
}

/**
 * 任务步骤接口定义
 */
export interface TaskStep {
  id: string;
  stepNumber: number;
  action: string;
  parameters: any;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  executedAt?: Date;
}

/**
 * GPT-4服务类
 * 专注于自然语言指令解析，使用 MCP 服务进行浏览器操作
 */
export class GPTService {
  /**
   * 初始化服务（确保 MCP 服务可用）
   */
  async initialize(): Promise<void> {
    try {
      // 确保 MCP 服务已连接
      if (!mcpService.isConnectedToMCP()) {
        await mcpService.initialize();
      }
      gptLogger.info('GPT 服务初始化完成');
    } catch (error) {
      gptLogger.error('GPT 服务初始化失败:', error);
      throw error;
    }
  }

  /**
   * 检查服务状态
   */
  isReady(): boolean {
    return mcpService.isConnectedToMCP();
  }
  /**
   * 解析自然语言指令为具体操作步骤
   * @param url 目标网页地址
   * @param instructions 自然语言操作指令
   * @returns 解析后的操作步骤数组
   */
  async parseInstructions(url: string, instructions: string): Promise<TaskStep[]> {
    try {
      const systemPrompt = `你是一个浏览器自动化助手，需要将用户的自然语言指令转换为具体的浏览器操作步骤。

可用的 MCP 工具函数及其用途：

页面导航和管理：
- navigate_page: 导航到指定URL
- new_page: 创建新页面
- close_page: 关闭页面
- list_pages: 列出所有页面
- select_page: 选择页面
- navigate_page_history: 前进/后退
- resize_page: 调整页面尺寸

页面交互：
- click: 点击元素（需要uid参数）
- fill: 填写单个表单字段（需要uid和value参数）
- fill_form: 批量填写表单（需要elements数组）
- hover: 悬停在元素上（需要uid参数）
- drag: 拖拽元素（需要from_uid和to_uid参数）
- upload_file: 上传文件（需要uid和filePath参数）

页面信息获取：
- take_snapshot: 获取页面快照（返回元素uid）
- take_screenshot: 截图
- evaluate_script: 执行JavaScript代码
- wait_for: 等待指定文本出现

网络和性能：
- list_network_requests: 列出网络请求
- get_network_request: 获取特定网络请求
- emulate_network: 模拟网络条件
- emulate_cpu: 模拟CPU节流
- performance_start_trace: 开始性能追踪
- performance_stop_trace: 停止性能追踪
- performance_analyze_insight: 分析性能洞察

调试和监控：
- list_console_messages: 列出控制台消息
- handle_dialog: 处理浏览器对话框

重要规则：
1. 所有页面交互操作（click、fill、hover等）都需要先调用 take_snapshot 获取元素的uid
2. 必须使用准确的工具函数名称，不要使用不存在的函数
3. 参数必须符合工具函数的要求格式
4. 操作顺序要合理：先导航页面，再获取快照，然后进行交互

请将指令解析为JSON格式的步骤数组，每个步骤包含：
- action: MCP工具函数名称（必须是上述列表中的函数）
- parameters: 操作参数对象
- description: 操作描述

示例输出：
[
  {
    "action": "navigate_page",
    "parameters": { "url": "https://example.com" },
    "description": "导航到目标网页"
  },
  {
    "action": "take_snapshot",
    "parameters": {},
    "description": "获取页面元素快照"
  },
  {
    "action": "click",
    "parameters": { "uid": "element_uid_from_snapshot" },
    "description": "点击登录按钮"
  }
]`;

      const userPrompt = `目标网页: ${url}
操作指令: ${instructions}

请将上述指令解析为使用 MCP 工具函数的具体操作步骤。注意：
1. 必须使用准确的 MCP 工具函数名称
2. 交互操作前必须先获取页面快照
3. 参数格式要正确
4. 步骤要符合实际操作逻辑

请返回JSON格式的步骤数组：`;

      console.log('[GPT] 开始调用OpenAI API...');
      
      // 创建带超时的Promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('GPT服务调用超时（30秒）'));
        }, 30000); // 30秒超时
      });

      const apiPromise = getDeepSeekClient().chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1, // 降低温度以获得更精确的输出
        max_tokens: 3000
      });

      // 使用Promise.race来实现超时控制
      const completion = await Promise.race([apiPromise, timeoutPromise]) as any;

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error('GPT-4响应为空');
      }

      // 解析JSON响应
      let parsedSteps: any[];
      try {
        // 提取JSON部分（去除可能的markdown格式）
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        const jsonStr = jsonMatch ? jsonMatch[0] : response;
        parsedSteps = JSON.parse(jsonStr);
      } catch (parseError) {
        gptLogger.error('解析GPT响应失败', {}, parseError);
        gptLogger.error('原始响应', {}, response);
        // 如果解析失败，创建基础步骤
        parsedSteps = [
          {
            action: 'navigate_page',
            parameters: { url },
            description: '导航到目标网页'
          },
          {
            action: 'take_snapshot',
            parameters: {
              // 不提供selector，让extractData方法提取所有可交互元素
            },
            description: '获取页面快照和可交互元素信息'
          }
        ];
      }

      gptLogger.info('GPT-4解析指令成功', {}, parsedSteps);

      // 转换为TaskStep格式并验证
      const taskSteps: TaskStep[] = parsedSteps.map((step, index) => ({
        id: uuidv4(),
        stepNumber: index + 1,
        action: step.action || 'navigate_page',
        parameters: step.parameters || {},
        description: step.description || `步骤 ${index + 1}`,
        status: 'pending' as const
      }));

      // 验证步骤中的工具函数名称
      const validMCPTools = [
        'list_console_messages', 'emulate_cpu', 'emulate_network', 'click', 'drag', 'fill', 
        'fill_form', 'hover', 'upload_file', 'get_network_request', 'list_network_requests', 
        'close_page', 'handle_dialog', 'list_pages', 'navigate_page', 'navigate_page_history', 
        'new_page', 'resize_page', 'select_page', 'performance_analyze_insight', 
        'performance_start_trace', 'performance_stop_trace', 'take_screenshot', 
        'evaluate_script', 'take_snapshot', 'wait_for'
      ];

      // 过滤无效的工具函数
      const validSteps = taskSteps.filter(step => {
        if (!validMCPTools.includes(step.action)) {
          gptLogger.warn(`过滤无效的工具函数: ${step.action}`);
          return false;
        }
        return true;
      });

      // 如果没有有效步骤，返回默认步骤
      if (validSteps.length === 0) {
        return [
          {
            id: uuidv4(),
            stepNumber: 1,
            action: 'navigate_page',
            parameters: { url },
            description: '导航到目标网页',
            status: 'pending'
          },
          {
            id: uuidv4(),
            stepNumber: 2,
            action: 'take_snapshot',
            parameters: {
              // 不提供selector，让extractData方法提取所有可交互元素
            },
            description: '获取页面快照和可交互元素信息',
            status: 'pending'
          }
        ];
      }

      return validSteps;
    } catch (error) {
      console.error('[GPT] GPT-4解析指令失败:', error);
      
      // 根据错误类型提供更详细的错误信息
      if (error instanceof Error) {
        if (error.message.includes('超时')) {
          console.error('[GPT] 错误类型: API调用超时');
        } else if (error.message.includes('Connection error')) {
          console.error('[GPT] 错误类型: 网络连接失败，请检查网络设置或配置代理');
        } else if (error.message.includes('API key')) {
          console.error('[GPT] 错误类型: API密钥无效');
        }
      }
      
      gptLogger.error('GPT-4解析指令失败', {}, error);
      
      // 返回默认步骤
      return [
        {
          id: uuidv4(),
          stepNumber: 1,
          action: 'navigate_page',
          parameters: { url },
          description: '导航到目标网页',
          status: 'pending'
        },
        {
          id: uuidv4(),
          stepNumber: 2,
          action: 'take_snapshot',
          parameters: {
            // 不提供selector，让extractData方法提取所有可交互元素
          },
          description: '获取页面快照和可交互元素信息',
          status: 'pending'
        }
      ];
    }
  }

  /**
   * 生成操作步骤的详细说明
   * @param steps 操作步骤数组
   * @returns 格式化的步骤说明
   */
  generateStepDescription(steps: TaskStep[]): string {
    return steps.map((step, index) => 
      `${index + 1}. ${step.description}`
    ).join('\n');
  }

  /**
   * 验证操作步骤的有效性
   * @param steps 操作步骤数组
   * @returns 验证结果
   */
  validateSteps(steps: TaskStep[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const validMCPTools = [
      'list_console_messages', 'emulate_cpu', 'emulate_network', 'click', 'drag', 'fill', 
      'fill_form', 'hover', 'upload_file', 'get_network_request', 'list_network_requests', 
      'close_page', 'handle_dialog', 'list_pages', 'navigate_page', 'navigate_page_history', 
      'new_page', 'resize_page', 'select_page', 'performance_analyze_insight', 
      'performance_start_trace', 'performance_stop_trace', 'take_screenshot', 
      'evaluate_script', 'take_snapshot', 'wait_for'
    ];

    steps.forEach((step, index) => {
      // 检查工具函数名称
      if (!validMCPTools.includes(step.action)) {
        errors.push(`步骤 ${index + 1}: 无效的 MCP 工具函数 '${step.action}'`);
      }

      // 检查必需参数
      switch (step.action) {
        case 'navigate_page':
          if (!step.parameters.url) {
            errors.push(`步骤 ${index + 1}: navigate_page 需要 url 参数`);
          }
          break;
        case 'click':
        case 'hover':
          if (!step.parameters.uid) {
            errors.push(`步骤 ${index + 1}: ${step.action} 需要 uid 参数`);
          }
          break;
        case 'fill':
          if (!step.parameters.uid || !step.parameters.value) {
            errors.push(`步骤 ${index + 1}: fill 需要 uid 和 value 参数`);
          }
          break;
        case 'fill_form':
          if (!step.parameters.elements || !Array.isArray(step.parameters.elements)) {
            errors.push(`步骤 ${index + 1}: fill_form 需要 elements 数组参数`);
          }
          break;
        case 'drag':
          if (!step.parameters.from_uid || !step.parameters.to_uid) {
            errors.push(`步骤 ${index + 1}: drag 需要 from_uid 和 to_uid 参数`);
          }
          break;
        case 'upload_file':
          if (!step.parameters.uid || !step.parameters.filePath) {
            errors.push(`步骤 ${index + 1}: upload_file 需要 uid 和 filePath 参数`);
          }
          break;
        case 'wait_for':
          if (!step.parameters.text) {
            errors.push(`步骤 ${index + 1}: wait_for 需要 text 参数`);
          }
          break;
        case 'evaluate_script':
          if (!step.parameters.function) {
            errors.push(`步骤 ${index + 1}: evaluate_script 需要 function 参数`);
          }
          break;
        case 'resize_page':
          if (!step.parameters.width || !step.parameters.height) {
            errors.push(`步骤 ${index + 1}: resize_page 需要 width 和 height 参数`);
          }
          break;
        case 'select_page':
        case 'close_page':
          if (step.parameters.pageIdx === undefined) {
            errors.push(`步骤 ${index + 1}: ${step.action} 需要 pageIdx 参数`);
          }
          break;
        case 'new_page':
          if (!step.parameters.url) {
            errors.push(`步骤 ${index + 1}: new_page 需要 url 参数`);
          }
          break;
        case 'navigate_page_history':
          if (!step.parameters.navigate || !['back', 'forward'].includes(step.parameters.navigate)) {
            errors.push(`步骤 ${index + 1}: navigate_page_history 需要 navigate 参数（'back' 或 'forward'）`);
          }
          break;
        case 'emulate_network':
          if (!step.parameters.throttlingOption) {
            errors.push(`步骤 ${index + 1}: emulate_network 需要 throttlingOption 参数`);
          }
          break;
        case 'emulate_cpu':
          if (!step.parameters.throttlingRate) {
            errors.push(`步骤 ${index + 1}: emulate_cpu 需要 throttlingRate 参数`);
          }
          break;
        case 'handle_dialog':
          if (!step.parameters.action || !['accept', 'dismiss'].includes(step.parameters.action)) {
            errors.push(`步骤 ${index + 1}: handle_dialog 需要 action 参数（'accept' 或 'dismiss'）`);
          }
          break;
        case 'get_network_request':
          if (!step.parameters.url) {
            errors.push(`步骤 ${index + 1}: get_network_request 需要 url 参数`);
          }
          break;
        case 'performance_analyze_insight':
          if (!step.parameters.insightName) {
            errors.push(`步骤 ${index + 1}: performance_analyze_insight 需要 insightName 参数`);
          }
          break;
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 析构函数 - 清理资源
   */
  async destroy(): Promise<void> {
    // GPT 服务本身不需要特殊清理，MCP 服务会自行管理连接
    gptLogger.info('GPT 服务已清理');
  }
}

// 导出单例实例
export const gptService = new GPTService();

// 进程退出时清理资源
process.on('exit', async () => {
  await gptService.destroy();
});

process.on('SIGINT', async () => {
  await gptService.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await gptService.destroy();
  process.exit(0);
});