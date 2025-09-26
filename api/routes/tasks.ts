/**
 * 任务管理API路由
 * 提供任务创建、执行控制、状态查询和历史查询功能
 */

import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { gptService } from '../services/gpt-service.js';
import { browserService } from '../services/browser-service.js';

const router = express.Router();

// 内存中的任务存储（生产环境应使用数据库）
interface Task {
  id: string;
  url: string;
  instructions: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  options?: {
    timeout?: number;
    screenshot?: boolean;
  };
  steps: TaskStep[];
  logs: TaskLog[];
  screenshots: TaskScreenshot[];
  result?: any;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

interface TaskStep {
  id: string;
  stepNumber: number;
  action: string;
  parameters: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  executedAt?: Date;
}

interface TaskLog {
  id: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  metadata?: any;
  timestamp: Date;
}

interface TaskScreenshot {
  id: string;
  stepNumber: number;
  imageUrl: string;
  description: string;
  timestamp: Date;
}

// 任务存储
const tasks: Map<string, Task> = new Map();

/**
 * 创建新任务
 * POST /api/tasks/create
 */
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { url, instructions, options } = req.body;

    // 参数验证
    if (!url || !instructions) {
      return res.status(400).json({
        success: false,
        error: 'URL和操作指令不能为空'
      });
    }

    // 创建任务ID
    const taskId = uuidv4();
    
    // 创建任务对象
    const task: Task = {
      id: taskId,
      url,
      instructions,
      status: 'pending',
      options: options || {},
      steps: [],
      logs: [],
      screenshots: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // 存储任务
    tasks.set(taskId, task);

    // 添加创建日志
    const createLog: TaskLog = {
      id: uuidv4(),
      level: 'info',
      message: `任务创建成功: ${instructions}`,
      metadata: { url, options },
      timestamp: new Date()
    };
    task.logs.push(createLog);

    // TODO: 调用GPT-4解析操作指令为具体步骤
    // 这里先创建一个示例步骤
    const sampleStep: TaskStep = {
      id: uuidv4(),
      stepNumber: 1,
      action: 'navigate',
      parameters: { url },
      status: 'pending'
    };
    task.steps.push(sampleStep);

    res.json({
      success: true,
      data: {
        taskId,
        status: task.status,
        steps: task.steps
      }
    });
  } catch (error) {
    console.error('创建任务失败:', error);
    res.status(500).json({
      success: false,
      error: '创建任务失败'
    });
  }
});

/**
 * 执行任务控制
 * POST /api/tasks/:id/execute
 */
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    const task = tasks.get(id);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    // 根据动作更新任务状态
    switch (action) {
      case 'start':
        if (task.status === 'pending') {
          task.status = 'running';
          task.updatedAt = new Date();
          
          // 添加开始执行日志
          task.logs.push({
            id: uuidv4(),
            level: 'info',
            message: '开始执行任务',
            timestamp: new Date()
          });

          // 启动浏览器自动化执行
          executeTaskAutomation(task).catch(error => {
            console.error('任务自动化执行失败:', error);
            task.status = 'failed';
            task.logs.push({
              id: uuidv4(),
              level: 'error',
              message: `任务执行失败: ${error.message}`,
              timestamp: new Date()
            });
          });
        }
        break;
      case 'pause':
        if (task.status === 'running') {
          task.status = 'pending';
          task.updatedAt = new Date();
          
          task.logs.push({
            id: uuidv4(),
            level: 'info',
            message: '任务已暂停',
            timestamp: new Date()
          });
        }
        break;
      case 'resume':
        if (task.status === 'pending') {
          task.status = 'running';
          task.updatedAt = new Date();
          
          task.logs.push({
            id: uuidv4(),
            level: 'info',
            message: '任务已恢复',
            timestamp: new Date()
          });
        }
        break;
      case 'stop':
        task.status = 'cancelled';
        task.updatedAt = new Date();
        task.completedAt = new Date();
        
        task.logs.push({
          id: uuidv4(),
          level: 'info',
          message: '任务已停止',
          timestamp: new Date()
        });
        break;
      default:
        return res.status(400).json({
          success: false,
          error: '无效的执行动作'
        });
    }

    // 计算执行进度
    const completedSteps = task.steps.filter(step => step.status === 'completed').length;
    const progress = task.steps.length > 0 ? (completedSteps / task.steps.length) * 100 : 0;
    const currentStep = task.steps.findIndex(step => step.status === 'running') + 1;

    res.json({
      success: true,
      data: {
        status: task.status,
        currentStep: currentStep || 1,
        progress: Math.round(progress)
      }
    });
  } catch (error) {
    console.error('执行任务控制失败:', error);
    res.status(500).json({
      success: false,
      error: '执行任务控制失败'
    });
  }
});

/**
 * 查询任务状态
 * GET /api/tasks/:id/status
 */
router.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const task = tasks.get(id);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    res.json({
      success: true,
      data: {
        status: task.status,
        logs: task.logs,
        screenshots: task.screenshots,
        result: task.result
      }
    });
  } catch (error) {
    console.error('查询任务状态失败:', error);
    res.status(500).json({
      success: false,
      error: '查询任务状态失败'
    });
  }
});

/**
 * 查询任务历史
 * GET /api/tasks
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;

    // 获取所有任务
    let allTasks = Array.from(tasks.values());

    // 状态筛选
    if (status) {
      allTasks = allTasks.filter(task => task.status === status);
    }

    // 按创建时间倒序排序
    allTasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // 分页
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedTasks = allTasks.slice(startIndex, endIndex);

    // 简化任务数据（不包含详细日志和截图）
    const simplifiedTasks = paginatedTasks.map(task => ({
      id: task.id,
      url: task.url,
      instructions: task.instructions,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      stepsCount: task.steps.length,
      logsCount: task.logs.length
    }));

    res.json({
      success: true,
      data: {
        tasks: simplifiedTasks,
        total: allTasks.length,
        page,
        limit,
        totalPages: Math.ceil(allTasks.length / limit)
      }
    });
  } catch (error) {
    console.error('查询任务历史失败:', error);
    res.status(500).json({
      success: false,
      error: '查询任务历史失败'
    });
  }
});

/**
 * 获取任务详情
 * GET /api/tasks/:id
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const task = tasks.get(id);
    if (!task) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    res.json({
      success: true,
      data: task
    });
  } catch (error) {
    console.error('获取任务详情失败:', error);
    res.status(500).json({
      success: false,
      error: '获取任务详情失败'
    });
  }
});

/**
 * 执行任务自动化流程
 * @param task 要执行的任务
 */
async function executeTaskAutomation(task: Task): Promise<void> {
  try {
    console.log('开始执行任务自动化:', task.id);
    console.log('任务描述:', task.instructions);
    
    // 添加开始解析日志
    task.logs.push({
      id: uuidv4(),
      level: 'info',
      message: '开始解析任务指令...',
      timestamp: new Date()
    });

    // 1. 使用GPT服务解析任务指令为具体步骤
    const steps = await gptService.parseInstructions(task.url, task.instructions);
    task.steps = steps;
    
    task.logs.push({
      id: uuidv4(),
      level: 'info',
      message: `任务解析完成，共生成 ${steps.length} 个执行步骤`,
      timestamp: new Date()
    });

    // 2. 初始化服务连接
    console.log('正在初始化 GPT 服务...');
    await gptService.initialize();
    console.log('GPT 服务初始化完成');
    
    console.log('正在连接浏览器服务...');
    await browserService.connect();
    console.log('浏览器服务连接完成');
    
    // 获取并记录可用的MCP工具列表
    try {
      const mcpService = browserService.getMCPService();
      console.log('正在获取可用的 MCP 工具...');
      const toolsList = await mcpService.listTools();
      console.log('可用的 MCP 工具:', toolsList.tools?.map(t => t.name) || []);
      
      task.logs.push({
        id: uuidv4(),
        level: 'info',
        message: `MCP 可用工具列表: ${JSON.stringify(toolsList.tools?.map(t => t.name) || [], null, 2)}`,
        timestamp: new Date()
      });
    } catch (error) {
      task.logs.push({
        id: uuidv4(),
        level: 'warn',
        message: `获取MCP工具列表失败: ${error.message}`,
        timestamp: new Date()
      });
    }
    
    task.logs.push({
      id: uuidv4(),
      level: 'info',
      message: 'MCP 服务连接成功，开始执行自动化步骤...',
      timestamp: new Date()
    });

    // 3. 创建新的浏览器标签页
    console.log('正在创建新标签页...');
    const pageId = await browserService.createNewTab();
    console.log('创建的页面 ID:', pageId);
    
    task.logs.push({
      id: uuidv4(),
      level: 'info',
      message: '浏览器标签页创建成功',
      timestamp: new Date()
    });

    // 4. 逐步执行自动化操作
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      console.log(`\n=== 执行步骤 ${i + 1}/${steps.length} ===`);
      console.log('指令详情:', step);
      
      // 检查任务是否被暂停或停止
      if (task.status !== 'running') {
        task.logs.push({
          id: uuidv4(),
          level: 'warn',
          message: '任务执行被中断',
          timestamp: new Date()
        });
        break;
      }

      // 【修复关键点1】步骤执行前检查连接状态
      // 这是防止浏览器服务在执行过程中断开的核心机制
      // 每个步骤执行前都会进行健康检查，确保MCP连接和浏览器页面状态正常
      try {
        const isHealthy = await browserService.healthCheck();
        if (!isHealthy) {
          console.log(`步骤 ${i + 1} 执行前检测到连接异常，尝试重新连接...`);
          task.logs.push({
            id: uuidv4(),
            level: 'warn',
            message: `步骤 ${step.stepNumber} 执行前检测到连接异常，正在重新连接...`,
            timestamp: new Date()
          });
          
          // 先断开旧连接，再建立新连接
          await browserService.disconnect();
          await browserService.connect();
          
          task.logs.push({
            id: uuidv4(),
            level: 'info',
            message: `步骤 ${step.stepNumber} 连接已恢复`,
            timestamp: new Date()
          });
        }
      } catch (healthCheckError) {
        console.error(`步骤 ${i + 1} 连接健康检查失败:`, healthCheckError);
        task.logs.push({
          id: uuidv4(),
          level: 'error',
          message: `步骤 ${step.stepNumber} 连接检查失败: ${healthCheckError.message}`,
          timestamp: new Date()
        });
        
        // 连接检查失败，跳过当前步骤但不中断整个任务
        step.status = 'failed';
        continue;
      }

      // 更新步骤状态为执行中
      step.status = 'running';
      step.executedAt = new Date();
      
      task.logs.push({
        id: uuidv4(),
        level: 'info',
        message: `执行步骤 ${step.stepNumber}: ${step.description}`,
        timestamp: new Date()
      });

      // 执行步骤 - 使用 MCP 协议
      try {
        const stepStartTime = Date.now();
        let result: any;
        
        switch (step.action) {
          case 'navigate':
            console.log(`导航到: ${step.parameters.url || task.url}`);
            result = await browserService.navigate(step.parameters.url || task.url);
            break;
          case 'click':
            console.log(`点击元素: ${step.parameters.selector}`);
            result = await browserService.click(step.parameters.selector);
            break;
          case 'type':
            console.log(`输入文本到: ${step.parameters.selector}`);
            result = await browserService.type(step.parameters.selector, step.parameters.text);
            break;
          case 'scroll':
            console.log(`滚动: ${step.parameters.direction || 'down'}, 距离: ${step.parameters.distance || 300}`);
            result = await browserService.scroll(step.parameters.direction || 'down', step.parameters.distance || 300);
            break;
          case 'wait':
            console.log(`等待: ${step.parameters.selector || step.parameters.condition}`);
            result = await browserService.waitFor(step.parameters.selector || step.parameters.condition);
            break;
          case 'screenshot':
            console.log('正在截图...');
            result = await browserService.takeScreenshot();
            break;
          case 'extract':
            console.log(`提取数据: ${step.parameters.selector}`);
            result = await browserService.extractData(step.parameters.selector, step.parameters.attribute);
            break;
          default:
            throw new Error(`不支持的操作类型: ${step.action}`);
        }
        
        const stepDuration = Date.now() - stepStartTime;
        console.log(`步骤 ${i + 1} 执行完成，耗时: ${stepDuration}ms`);
        
        step.status = 'completed';
        task.logs.push({
          id: uuidv4(),
          level: 'info',
          message: `步骤 ${step.stepNumber} 执行成功: ${step.description}`,
          timestamp: new Date()
        });

        // 如果是截图操作，保存截图数据
        if (step.action === 'screenshot' && result) {
          task.screenshots.push({
            id: uuidv4(),
            stepNumber: step.stepNumber,
            imageUrl: result.imageUrl || result.data,
            description: step.description,
            timestamp: new Date()
          });
        }
        
      } catch (stepError) {
        const errorMessage = stepError instanceof Error ? stepError.message : '未知错误';
        console.error(`步骤 ${i + 1} 执行失败:`, stepError);
        
        // 【修复关键点2】智能错误识别和重试机制
        // 检查是否为连接相关错误，如果是则尝试重连后重试
        // 这解决了因临时连接问题导致整个任务失败的问题
        const isConnectionError = errorMessage.toLowerCase().includes('connection') || 
                                 errorMessage.toLowerCase().includes('disconnect') ||
                                 errorMessage.toLowerCase().includes('timeout') ||
                                 errorMessage.toLowerCase().includes('mcp');
        
        if (isConnectionError && !step.retryCount) {
          console.log(`步骤 ${i + 1} 检测到连接错误，尝试重连后重试...`);
          task.logs.push({
            id: uuidv4(),
            level: 'warn',
            message: `步骤 ${step.stepNumber} 检测到连接错误，正在重连后重试: ${errorMessage}`,
            timestamp: new Date()
          });
          
          try {
            // 【修复关键点3】重新建立连接的完整流程
            // 先断开连接，等待2秒让资源释放，再重新连接
            await browserService.disconnect();
            await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
            await browserService.connect();
            
            // 标记为重试并重新执行当前步骤
            step.retryCount = 1;
            i--; // 重新执行当前步骤
            continue;
          } catch (reconnectError) {
            console.error(`步骤 ${i + 1} 重连失败:`, reconnectError);
            task.logs.push({
              id: uuidv4(),
              level: 'error',
              message: `步骤 ${step.stepNumber} 重连失败: ${reconnectError.message}`,
              timestamp: new Date()
            });
          }
        }
        
        // 步骤最终失败
        step.status = 'failed';
        task.logs.push({
          id: uuidv4(),
          level: 'error',
          message: `步骤 ${step.stepNumber} 执行失败: ${errorMessage}`,
          timestamp: new Date()
        });
        
        // 步骤失败时继续执行后续步骤，但记录失败信息
        console.log(`步骤 ${i + 1} 失败，继续执行后续步骤...`);
      }

      // 更新任务进度
      const completedSteps = task.steps.filter(s => s.status === 'completed').length;
      const progress = (completedSteps / task.steps.length) * 100;
      
      // 添加进度日志
      if (i % 3 === 0 || i === steps.length - 1) { // 每3步或最后一步记录进度
        task.logs.push({
          id: uuidv4(),
          level: 'info',
          message: `任务进度: ${Math.round(progress)}% (${completedSteps}/${task.steps.length})`,
          timestamp: new Date()
        });
      }

      // 步骤间短暂延迟，避免操作过快
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n=== 任务自动化执行完成 ===');
    
    // 【修复关键点4】任务完成后的连接保持策略
    // 任务执行完成后不再自动断开浏览器服务连接
    // 这样可以让后续任务继续使用同一个连接，避免重复连接开销
    // 5. 执行完成后的处理
    const completedSteps = task.steps.filter(step => step.status === 'completed').length;
    const failedSteps = task.steps.filter(step => step.status === 'failed').length;
    
    if (failedSteps === 0) {
      task.status = 'completed';
      task.logs.push({
        id: uuidv4(),
        level: 'info',
        message: `任务执行完成！成功执行 ${completedSteps} 个步骤`,
        timestamp: new Date()
      });
    } else {
      task.status = 'failed';
      task.logs.push({
        id: uuidv4(),
        level: 'error',
        message: `任务执行完成，但有 ${failedSteps} 个步骤失败`,
        timestamp: new Date()
      });
    }
    
    task.completedAt = new Date();
    task.updatedAt = new Date();

    // 6. 任务完成，保持连接以供后续任务使用
    console.log('任务执行完成，保持浏览器服务连接以供后续任务使用');
    // 注意：不在这里断开连接，让连接保持活跃状态供后续任务使用
    
  } catch (error) {
    console.error('\n=== 任务自动化执行失败 ===');
    console.error('错误详情:', error);
    
    task.status = 'failed';
    task.logs.push({
      id: uuidv4(),
      level: 'error',
      message: `任务执行异常: ${error instanceof Error ? error.message : '未知错误'}`,
      timestamp: new Date()
    });
    task.completedAt = new Date();
    task.updatedAt = new Date();
    
    // 发生异常时进行连接清理和重置
    try {
      console.log('任务执行异常，检查连接状态...');
      
      // 检查连接健康状态
      const isHealthy = await browserService.healthCheck();
      if (!isHealthy) {
        console.log('连接不健康，尝试重新连接...');
        await browserService.disconnect();
        await browserService.connect();
        console.log('连接已重新建立');
      } else {
        console.log('连接状态正常，保持连接');
      }
    } catch (reconnectError) {
      console.error('重新连接时出错:', reconnectError);
      // 最后手段：强制断开连接
      try {
        await browserService.disconnect();
      } catch (forceDisconnectError) {
        console.error('强制断开连接时出错:', forceDisconnectError);
      }
    }
    
    throw error;
  }
}

export default router;