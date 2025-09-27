/**
 * 任务执行页面
 * 实时执行和监控浏览器自动化任务
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Eye,
  Download,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Monitor,
  Zap,
  ArrowLeft
} from 'lucide-react';
import { indexedDBService, Task, TaskLog, TaskScreenshot, TaskStatus } from '@/services/indexeddb-service';

/**
 * 执行状态配置
 */
const STATUS_CONFIG = {
  [TaskStatus.PENDING]: {
    label: '准备执行',
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    icon: Clock
  },
  [TaskStatus.RUNNING]: {
    label: '执行中',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    icon: Play
  },
  [TaskStatus.PAUSED]: {
    label: '已暂停',
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    icon: Pause
  },
  [TaskStatus.COMPLETED]: {
    label: '执行完成',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    icon: CheckCircle
  },
  [TaskStatus.FAILED]: {
    label: '执行失败',
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    icon: XCircle
  },
  [TaskStatus.CANCELLED]: {
    label: '已取消',
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
    icon: XCircle
  },
  [TaskStatus.STOPPED]: {
    label: '已停止',
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    icon: Square
  }
};

/**
 * 任务执行组件
 */
export default function TaskExecute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [screenshots, setScreenshots] = useState<TaskScreenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentStep, setCurrentStep] = useState('');
  const [selectedScreenshot, setSelectedScreenshot] = useState<TaskScreenshot | null>(null);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pollCleanupRef = useRef<(() => void) | null>(null);

  /**
   * 滚动到日志底部
   */
  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  /**
   * 加载任务数据
   */
  const loadTaskData = async () => {
    setDebugInfo(prev => [...prev, `开始加载任务数据 - ID: ${id}`]);
    
    if (!id) {
      setError('任务ID不存在');
      setLoading(false);
      setDebugInfo(prev => [...prev, '错误: 任务ID不存在']);
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      console.log('设置loading为true，开始获取任务数据...');
      
      // 首先尝试从IndexedDB获取任务数据
      let taskData: Task | null = null;
      let taskLogs: TaskLog[] = [];
      let taskScreenshots: TaskScreenshot[] = [];
      
      try {
        [taskData, taskLogs, taskScreenshots] = await Promise.all([
          indexedDBService.getTask(id),
          indexedDBService.getTaskLogs(id),
          indexedDBService.getTaskScreenshots(id)
        ]);
        setDebugInfo(prev => [...prev, `IndexedDB查询结果: ${taskData ? '找到任务' : '未找到任务'}`]);
      } catch (err) {
        console.error('从IndexedDB获取任务数据失败:', err);
        setDebugInfo(prev => [...prev, `IndexedDB查询失败: ${err}`]);
      }
      
      // 如果IndexedDB中没有找到任务，尝试从后端API获取
      if (!taskData) {
        console.log('IndexedDB中未找到任务，尝试从后端API获取...');
        try {
          const response = await fetch(`/api/tasks/${id}`);
          if (response.ok) {
            const apiResult = await response.json();
            if (apiResult.success && apiResult.data) {
              // 将后端任务数据转换为前端格式
              const backendTask = apiResult.data;
              taskData = {
                id: backendTask.id,
                title: backendTask.instructions || '未命名任务',
                description: '',
                url: backendTask.url,
                instructions: backendTask.instructions,
                status: backendTask.status as TaskStatus,
                createdAt: backendTask.createdAt,
                updatedAt: backendTask.updatedAt,
                startedAt: backendTask.startedAt,
                completedAt: backendTask.completedAt,
                progress: 0,
                totalSteps: backendTask.steps?.length || 0,
                currentStep: 0,
                error: backendTask.error
              };
              
              // 将任务数据同步到IndexedDB
              try {
                await indexedDBService.createTask(taskData);
                console.log('任务数据已同步到IndexedDB');
              } catch (syncError) {
                console.warn('同步任务数据到IndexedDB失败:', syncError);
              }
              
              // 转换后端日志数据
              if (backendTask.logs && Array.isArray(backendTask.logs)) {
                taskLogs = backendTask.logs.map((log: any, index: number) => ({
                  id: log.id || `log-${index}`,
                  taskId: id,
                  stepIndex: index,
                  action: 'unknown',
                  parameters: log.metadata || {},
                  result: null,
                  success: log.level !== 'error',
                  message: log.message,
                  level: log.level || 'info',
                  timestamp: log.timestamp,
                  duration: 0,
                  error: log.level === 'error' ? log.message : undefined
                }));
              }
            }
          } else {
            console.log('后端API也未找到任务');
          }
        } catch (apiError) {
          console.error('从后端API获取任务失败:', apiError);
        }
      }
      
      if (!taskData) {
        console.log('未找到任务数据');
        setError('任务不存在或已被删除');
        setTask(null);
        return;
      }
      
      console.log('找到任务数据:', taskData);
      
      // 验证任务数据的完整性
      if (!taskData.id || !taskData.instructions) {
        console.log('任务数据不完整:', { id: taskData.id, instructions: taskData.instructions });
        setError('任务数据不完整');
        return;
      }
      
      console.log('设置任务数据到state');
      setTask(taskData);
      setLogs(taskLogs || []);
      setScreenshots(taskScreenshots || []);
      
    } catch (err) {
      console.error('加载任务数据失败:', err);
      setError(err instanceof Error ? err.message : '加载任务数据失败');
      setTask(null);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 建立WebSocket连接监听任务执行
   */
  const connectWebSocket = () => {
    setDebugInfo(prev => [...prev, `connectWebSocket被调用，id: ${id}`]);
    if (!id) {
      setDebugInfo(prev => [...prev, 'connectWebSocket: 缺少任务ID，退出']);
      return;
    }
    
    // 清理之前的轮询
    if (pollCleanupRef.current) {
      pollCleanupRef.current();
    }
    
    // 关闭现有的WebSocket连接
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    try {
      // 创建WebSocket连接
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname;
      // 使用API服务器的端口 (3002)
      const apiPort = '3002';
      const wsUrl = `${protocol}//${host}:${apiPort}/ws?taskId=${id}`;
      
      setDebugInfo(prev => [...prev, `尝试连接WebSocket: ${wsUrl}`]);
      console.log('尝试连接WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        setDebugInfo(prev => [...prev, 'WebSocket连接已建立']);
        console.log('WebSocket连接已建立');
      };
      
      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('收到WebSocket消息:', data);
          
          switch (data.type) {
            case 'task_log':
              // 实时添加新日志
              if (data.log) {
                setLogs(prevLogs => [...prevLogs, data.log]);
                // 自动滚动到底部
                setTimeout(scrollToBottom, 100);
              }
              break;
              
            case 'task_status':
              // 更新任务状态
              if (data.status) {
                setTask(prevTask => prevTask ? {
                  ...prevTask,
                  status: data.status.status,
                  progress: data.status.progress || prevTask.progress,
                  currentStep: data.status.currentStep || prevTask.currentStep,
                  updatedAt: data.status.updatedAt || new Date().toISOString()
                } : null);
                
                // 如果任务完成或失败，停止执行状态
                if (data.status.status === TaskStatus.COMPLETED || 
                    data.status.status === TaskStatus.FAILED ||
                    data.status.status === TaskStatus.CANCELLED ||
                    data.status.status === TaskStatus.STOPPED) {
                  setIsExecuting(false);
                }
              }
              break;
              
            case 'task_step':
              // 更新当前步骤信息
              if (data.step) {
                setCurrentStep(data.step.description || data.step.action || '');
                setTask(prevTask => prevTask ? {
                  ...prevTask,
                  currentStep: data.step.stepNumber || prevTask.currentStep
                } : null);
              }
              break;
              
            case 'error':
              // 处理错误消息
              console.error('WebSocket错误:', data.message);
              setError(data.message || '执行过程中发生错误');
              break;
              
            default:
              console.log('未知的WebSocket消息类型:', data.type);
          }
        } catch (err) {
          console.error('解析WebSocket消息失败:', err);
        }
      };
      
      ws.onerror = (error) => {
        setDebugInfo(prev => [...prev, `WebSocket连接错误: ${error}, URL: ${wsUrl}, readyState: ${ws.readyState}`]);
        console.error('WebSocket连接错误:', error);
        console.error('WebSocket URL:', wsUrl);
        console.error('WebSocket readyState:', ws.readyState);
        
        // 如果WebSocket连接失败，回退到轮询模式
        fallbackToPolling();
      };
      
      ws.onclose = (event) => {
        console.log('WebSocket连接已关闭:', event.code, event.reason);
        console.log('WebSocket URL:', wsUrl);
        wsRef.current = null;
        
        // 如果是异常关闭且任务仍在执行，尝试重连
        if (event.code !== 1000 && isExecuting) {
          console.log('WebSocket异常关闭，3秒后尝试重连...');
          setTimeout(() => {
            if (isExecuting) {
              connectWebSocket();
            }
          }, 3000);
        } else if (event.code !== 1000) {
          console.warn('WebSocket连接异常关闭，但任务未在执行，不重连');
        }
      };
      
    } catch (err) {
      console.error('创建WebSocket连接失败:', err);
      // 回退到轮询模式
      fallbackToPolling();
    }
  };
  
  /**
   * 回退到轮询模式
   */
  const fallbackToPolling = () => {
    console.log('WebSocket不可用，回退到轮询模式');
    
    // 清理之前的轮询
    if (pollCleanupRef.current) {
      pollCleanupRef.current();
    }
    
    // 启动轮询
    const pollInterval = setInterval(async () => {
      if (!isExecuting) {
        clearInterval(pollInterval);
        pollCleanupRef.current = null;
        return;
      }
      
      try {
        await loadTaskData();
      } catch (err) {
        console.error('轮询任务状态失败:', err);
      }
    }, 2000); // 每2秒轮询一次
    
    // 保存清理函数
    pollCleanupRef.current = () => {
      clearInterval(pollInterval);
      pollCleanupRef.current = null;
    };
  };

  /**
   * 执行任务控制操作
   * @param action 操作类型
   */
  const handleTaskControl = async (action: 'start' | 'pause' | 'resume' | 'stop') => {
    if (!id || !task) {
      setError('任务信息不完整，无法执行操作');
      return;
    }
    
    try {
      setError(null);
      
      const response = await fetch(`/api/tasks/${id}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action })
      });
      
      if (!response.ok) {
        let errorMessage = '操作失败';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      
      if (action === 'start' || action === 'resume') {
        setIsExecuting(true);
        setCurrentStep('正在启动...');
        // 建立WebSocket连接监听执行过程
        connectWebSocket();
      } else {
        setIsExecuting(false);
        setCurrentStep('');
        // 清理轮询
        if (pollCleanupRef.current) {
          pollCleanupRef.current();
        }
      }
      
      // 更新任务状态，确保安全更新
      if (result && result.status) {
        setTask(prev => prev ? { ...prev, status: result.status } : null);
      }
      
    } catch (err) {
      console.error(`${action}操作失败:`, err);
      const errorMessage = err instanceof Error ? err.message : `${action}操作失败`;
      setError(errorMessage);
      setIsExecuting(false);
      setCurrentStep('');
      
      // 清理轮询
      if (pollCleanupRef.current) {
        pollCleanupRef.current();
      }
    }
  };

  /**
   * 重新执行任务
   */
  const handleRestart = async () => {
    if (!id) return;
    
    try {
      // 重置任务状态
      await indexedDBService.updateTask(id, {
        status: TaskStatus.PENDING,
        progress: 0,
        currentStep: 0,
        updatedAt: new Date().toISOString()
      });
      
      // 清除旧的日志和截图
      await Promise.all([
        indexedDBService.clearTaskLogs(id),
        indexedDBService.clearTaskScreenshots(id)
      ]);
      
      // 重新加载数据
      await loadTaskData();
      
      // 自动开始执行
      handleTaskControl('start');
      
    } catch (err) {
      console.error('重新执行失败:', err);
      setError('重新执行失败');
    }
  };

  /**
   * 下载截图
   * @param screenshot 截图对象
   */
  const handleDownloadScreenshot = (screenshot: TaskScreenshot) => {
    try {
      const link = document.createElement('a');
      link.href = screenshot.imageData;
      link.download = `screenshot_${screenshot.stepNumber}_${new Date(screenshot.timestamp).getTime()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('下载截图失败:', err);
      setError('下载截图失败');
    }
  };

  /**
   * 格式化时间
   * @param timestamp 时间戳
   */
  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('zh-CN');
  };

  /**
   * 获取进度百分比
   */
  const getProgressPercentage = () => {
    if (!task || task.totalSteps === 0) return 0;
    return Math.round((task.currentStep / task.totalSteps) * 100);
  };

  // 组件挂载时加载数据并建立WebSocket连接
  useEffect(() => {
    loadTaskData();
    
    // 组件卸载时清理资源
    return () => {
      // 清理轮询
      if (pollCleanupRef.current) {
        pollCleanupRef.current();
      }
      // 关闭WebSocket连接
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [id]);
  
  // 当任务数据加载完成后，自动建立WebSocket连接
  useEffect(() => {
    setDebugInfo(prev => [...prev, `useEffect触发 - task: ${task?.id}, id: ${id}`]);
    if (task && id && !wsRef.current) {
      setDebugInfo(prev => [...prev, `任务数据已加载，准备建立WebSocket连接 - 状态: ${task.status}`]);
      connectWebSocket();
    } else if (wsRef.current) {
      setDebugInfo(prev => [...prev, 'WebSocket连接已存在，跳过重复连接']);
    } else {
      setDebugInfo(prev => [...prev, '任务数据未准备好，跳过WebSocket连接']);
    }
  }, [task, id]);

  // 日志更新时自动滚动
  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">加载中...</span>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="text-center py-12">
        <XCircle className="w-16 h-16 text-red-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">任务不存在</h3>
        <p className="text-gray-500 mb-6">请检查任务ID是否正确</p>
        <button
          onClick={() => navigate('/tasks')}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          返回任务列表
        </button>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[task.status];
  const StatusIcon = statusConfig?.icon;
  const progressPercentage = getProgressPercentage();

  // 如果状态配置不存在，显示错误信息
  if (!statusConfig) {
    return (
      <div className="text-center py-12">
        <XCircle className="w-16 h-16 text-red-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">任务状态异常</h3>
        <p className="text-gray-500 mb-6">任务状态 "{task.status}" 不被支持</p>
        <button
          onClick={() => navigate('/tasks')}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          返回任务列表
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* 调试信息 - 始终显示 */}
      <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <h4 className="font-semibold text-yellow-800 mb-2">调试信息 (共{debugInfo.length}条):</h4>
        <div className="text-sm text-yellow-700 space-y-1">
          {debugInfo.length === 0 ? (
            <div>暂无调试信息</div>
          ) : (
            debugInfo.map((info, index) => (
              <div key={index}>{info}</div>
            ))
          )}
        </div>
      </div>
      
      {/* 页面标题和返回按钮 */}
      <div className="flex items-center mb-6">
        <button
          onClick={() => navigate('/tasks')}
          className="flex items-center px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors mr-4"
        >
          <ArrowLeft className="w-5 h-5 mr-1" />
          返回
        </button>
        <div className="flex items-center">
          <Monitor className="w-8 h-8 text-blue-600 mr-3" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{task.title}</h1>
            <p className="text-gray-600">{task.url}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：任务控制和状态 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 任务状态卡片 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <div className={`flex items-center px-3 py-2 rounded-full text-sm font-medium ${statusConfig.bgColor} ${statusConfig.color}`}>
                  <StatusIcon className="w-4 h-4 mr-2" />
                  {statusConfig.label}
                </div>
                {isExecuting && (
                  <div className="ml-3 flex items-center text-blue-600">
                    <Zap className="w-4 h-4 mr-1 animate-pulse" />
                    <span className="text-sm">{currentStep}</span>
                  </div>
                )}
              </div>
              
              <button
                onClick={() => navigate(`/tasks/${task.id}`)}
                className="flex items-center px-3 py-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <Eye className="w-4 h-4 mr-1" />
                查看详情
              </button>
            </div>
            
            {/* 进度条 */}
            {task.totalSteps > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                  <span>执行进度</span>
                  <span>{task.currentStep}/{task.totalSteps} ({progressPercentage}%)</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercentage}%` }}
                  ></div>
                </div>
              </div>
            )}
            
            {/* 控制按钮 */}
            <div className="flex space-x-3">
              {task.status === TaskStatus.PENDING && (
                <button
                  onClick={() => handleTaskControl('start')}
                  disabled={isExecuting}
                  className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Play className="w-4 h-4 mr-2" />
                  开始执行
                </button>
              )}
              
              {task.status === TaskStatus.RUNNING && (
                <button
                  onClick={() => handleTaskControl('pause')}
                  className="flex items-center px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
                >
                  <Pause className="w-4 h-4 mr-2" />
                  暂停
                </button>
              )}
              
              {task.status === TaskStatus.PAUSED && (
                <button
                  onClick={() => handleTaskControl('resume')}
                  disabled={isExecuting}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Play className="w-4 h-4 mr-2" />
                  继续执行
                </button>
              )}
              
              {(task.status === TaskStatus.RUNNING || task.status === TaskStatus.PAUSED) && (
                <button
                  onClick={() => handleTaskControl('stop')}
                  className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  <Square className="w-4 h-4 mr-2" />
                  停止
                </button>
              )}
              
              {(task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED || task.status === TaskStatus.STOPPED) && (
                <button
                  onClick={handleRestart}
                  disabled={isExecuting}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  重新执行
                </button>
              )}
            </div>
          </div>
          
          {/* 错误提示 */}
          {error && (
            <div className="flex items-center p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-500 mr-3 flex-shrink-0" />
              <span className="text-red-700">{error}</span>
              <button
                onClick={() => setError(null)}
                className="ml-auto text-red-500 hover:text-red-700"
              >
                ×
              </button>
            </div>
          )}
          
          {/* 执行日志 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">执行日志</h3>
            </div>
            <div className="p-4">
              <div className="bg-gray-900 rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm">
                {logs.length === 0 ? (
                  <div className="text-gray-400 text-center py-8">
                    暂无执行日志
                  </div>
                ) : (
                  <div className="space-y-1">
                    {logs.map((log) => (
                      <div key={log.id} className="flex items-start space-x-3">
                        <span className="text-gray-400 text-xs mt-0.5 flex-shrink-0">
                          {formatTime(log.timestamp)}
                        </span>
                        <span className={`flex-1 ${
                          log.level === 'error' ? 'text-red-400' :
                          log.level === 'warn' ? 'text-yellow-400' :
                          log.level === 'info' ? 'text-blue-400' :
                          'text-gray-300'
                        }`}>
                          [{log.level.toUpperCase()}] {log.message}
                        </span>
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* 右侧：截图预览 */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">执行截图</h3>
            </div>
            <div className="p-4">
              {screenshots.length === 0 ? (
                <div className="text-gray-400 text-center py-8">
                  暂无截图
                </div>
              ) : (
                <div className="space-y-3">
                  {screenshots.slice(-5).reverse().map((screenshot) => (
                    <div key={screenshot.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      <img
                        src={screenshot.imageData}
                        alt={`步骤 ${screenshot.stepNumber}`}
                        className="w-full h-32 object-cover cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setSelectedScreenshot(screenshot)}
                      />
                      <div className="p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">
                            步骤 {screenshot.stepNumber}
                          </span>
                          <button
                            onClick={() => handleDownloadScreenshot(screenshot)}
                            className="p-1 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="下载截图"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatTime(screenshot.timestamp)}
                        </p>
                        {screenshot.description && (
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                            {screenshot.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* 截图预览模态框 */}
      {selectedScreenshot && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl max-h-full overflow-auto">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                步骤 {selectedScreenshot.stepNumber} - {formatTime(selectedScreenshot.timestamp)}
              </h3>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleDownloadScreenshot(selectedScreenshot)}
                  className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                  title="下载截图"
                >
                  <Download className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setSelectedScreenshot(null)}
                  className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="p-4">
              <img
                src={selectedScreenshot.imageData}
                alt={`步骤 ${selectedScreenshot.stepNumber}`}
                className="w-full h-auto"
              />
              {selectedScreenshot.description && (
                <p className="text-gray-600 mt-4">{selectedScreenshot.description}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}