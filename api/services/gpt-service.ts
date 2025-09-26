/**
 * GPT-4自然语言处理服务
 * 负责将用户的自然语言指令解析为具体的浏览器操作步骤
 * 使用 MCP 服务进行浏览器自动化
 */

import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { mcpService } from './mcp-service.js';

// 初始化OpenAI客户端
let openai: OpenAI | null = null;

// 延迟初始化 OpenAI 客户端
function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      throw new Error('请在 .env 文件中设置有效的 OPENAI_API_KEY');
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
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
      console.log('GPT 服务初始化完成');
    } catch (error) {
      console.error('GPT 服务初始化失败:', error);
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

支持的操作类型：
1. navigate - 导航到指定URL
2. click - 点击元素
3. type - 输入文本
4. scroll - 滚动页面
5. wait - 等待元素或时间
6. screenshot - 截图
7. extract - 提取数据

请将指令解析为JSON格式的步骤数组，每个步骤包含：
- action: 操作类型
- parameters: 操作参数（如选择器、文本、坐标等）
- description: 操作描述

示例输出：
[
  {
    "action": "navigate",
    "parameters": { "url": "https://example.com" },
    "description": "导航到目标网页"
  },
  {
    "action": "click",
    "parameters": { "selector": "#login-button" },
    "description": "点击登录按钮"
  }
]`;

      const userPrompt = `目标网页: ${url}\n操作指令: ${instructions}\n\n请解析为具体的操作步骤：`;

      const completion = await getOpenAIClient().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000
      });

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
        console.error('解析GPT响应失败:', parseError);
        // 如果解析失败，创建基础步骤
        parsedSteps = [
          {
            action: 'navigate',
            parameters: { url },
            description: '导航到目标网页'
          }
        ];
      }

      // 转换为TaskStep格式
      const taskSteps: TaskStep[] = parsedSteps.map((step, index) => ({
        id: uuidv4(),
        stepNumber: index + 1,
        action: step.action || 'navigate',
        parameters: step.parameters || {},
        description: step.description || `步骤 ${index + 1}`,
        status: 'pending' as const
      }));

      return taskSteps;
    } catch (error) {
      console.error('GPT-4解析指令失败:', error);
      
      // 返回默认步骤
      return [
        {
          id: uuidv4(),
          stepNumber: 1,
          action: 'navigate',
          parameters: { url },
          description: '导航到目标网页',
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
    const validActions = ['navigate', 'click', 'type', 'scroll', 'wait', 'screenshot', 'extract'];

    steps.forEach((step, index) => {
      // 检查操作类型
      if (!validActions.includes(step.action)) {
        errors.push(`步骤 ${index + 1}: 无效的操作类型 '${step.action}'`);
      }

      // 检查必需参数
      switch (step.action) {
        case 'navigate':
          if (!step.parameters.url) {
            errors.push(`步骤 ${index + 1}: navigate操作缺少url参数`);
          }
          break;
        case 'click':
          if (!step.parameters.selector && !step.parameters.coordinates) {
            errors.push(`步骤 ${index + 1}: click操作需要selector或coordinates参数`);
          }
          break;
        case 'type':
          if (!step.parameters.text || !step.parameters.selector) {
            errors.push(`步骤 ${index + 1}: type操作需要text和selector参数`);
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
    console.log('GPT 服务已清理');
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