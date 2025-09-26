/**
 * 任务详情页面
 * 显示任务的完整信息、执行历史和结果
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Eye,
  Download,
  Calendar,
  Clock,
  Globe,
  FileText,
  Image,
  Activity,
  CheckCircle,
  XCircle,
  AlertCircle,
  Pause,
  Square,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { indexedDBService, Task, TaskLog, TaskScreenshot, TaskStatus } from '@/services/indexeddb-service';

/**
 * 任务状态配置
 */
const STATUS_CONFIG = {
  [TaskStatus.PENDING]: {
    label: '待执行',
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
    label: '已完成',
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
  [TaskStatus.STOPPED]: {
    label: '已停止',
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    icon: Square
  }
};

/**
 * 日志级别配置
 */
const LOG_LEVEL_CONFIG = {
  error: { label: '错误', color: 'text-red-600', bgColor: 'bg-red-50' },
  warn: { label: '警告', color: 'text-yellow-600', bgColor: 'bg-yellow-50' },
  info: { label: '信息', color: 'text-blue-600', bgColor: 'bg-blue-50' },
  debug: { label: '调试', color: 'text-gray-600', bgColor: 'bg-gray-50' }
};

/**
 * 任务详情组件
 */
export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [screenshots, setScreenshots] = useState<TaskScreenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'screenshots'>('overview');
  const [selectedScreenshot, setSelectedScreenshot] = useState<TaskScreenshot | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  /**
   * 加载任务数据
   */
  const loadTaskData = async () => {
    if (!id) return;
    
    try {
      setLoading(true);
      const [taskData, taskLogs, taskScreenshots] = await Promise.all([
        indexedDBService.getTask(id),
        indexedDBService.getTaskLogs(id),
        indexedDBService.getTaskScreenshots(id)
      ]);
      
      if (!taskData) {
        setError('任务不存在');
        return;
      }
      
      setTask(taskData);
      setLogs(taskLogs);
      setScreenshots(taskScreenshots);
      setError(null);
    } catch (err) {
      console.error('加载任务数据失败:', err);
      setError('加载任务数据失败');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 删除任务
   */
  const handleDeleteTask = async () => {
    if (!id) return;
    
    try {
      await indexedDBService.deleteTask(id);
      navigate('/tasks');
    } catch (err) {
      console.error('删除任务失败:', err);
      setError('删除任务失败');
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
   * 下载所有截图
   */
  const handleDownloadAllScreenshots = () => {
    screenshots.forEach((screenshot, index) => {
      setTimeout(() => {
        handleDownloadScreenshot(screenshot);
      }, index * 100); // 延迟下载避免浏览器阻止
    });
  };

  /**
   * 导出执行日志
   */
  const handleExportLogs = () => {
    try {
      const logContent = logs.map(log => 
        `[${new Date(log.timestamp).toLocaleString()}] [${log.level.toUpperCase()}] ${log.message}`
      ).join('\n');
      
      const blob = new Blob([logContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `task_${id}_logs.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('导出日志失败:', err);
      setError('导出日志失败');
    }
  };

  /**
   * 格式化日期时间
   * @param dateString 日期字符串
   */
  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  /**
   * 格式化时间
   * @param dateString 日期字符串
   */
  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('zh-CN');
  };

  /**
   * 计算执行时长
   */
  const getExecutionDuration = () => {
    if (!task) return null;
    
    const start = new Date(task.createdAt).getTime();
    const end = new Date(task.updatedAt).getTime();
    const duration = end - start;
    
    if (duration < 1000) return '< 1秒';
    if (duration < 60000) return `${Math.round(duration / 1000)}秒`;
    if (duration < 3600000) return `${Math.round(duration / 60000)}分钟`;
    return `${Math.round(duration / 3600000)}小时`;
  };

  /**
   * 获取进度百分比
   */
  const getProgressPercentage = () => {
    if (!task || task.totalSteps === 0) return 0;
    return Math.round((task.currentStep / task.totalSteps) * 100);
  };

  // 组件挂载时加载数据
  useEffect(() => {
    loadTaskData();
  }, [id]);

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
  const StatusIcon = statusConfig.icon;
  const progressPercentage = getProgressPercentage();
  const executionDuration = getExecutionDuration();

  return (
    <div className="max-w-6xl mx-auto">
      {/* 页面标题和操作 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <button
            onClick={() => navigate('/tasks')}
            className="flex items-center px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors mr-4"
          >
            <ArrowLeft className="w-5 h-5 mr-1" />
            返回
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{task.title}</h1>
            <div className="flex items-center mt-1">
              <div className={`flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color} mr-3`}>
                <StatusIcon className="w-3 h-3 mr-1" />
                {statusConfig.label}
              </div>
              <span className="text-sm text-gray-500">创建于 {formatDateTime(task.createdAt)}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <button
            onClick={() => navigate(`/tasks/${task.id}/execute`)}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Play className="w-4 h-4 mr-2" />
            执行任务
          </button>
          <button
            onClick={() => setDeleteConfirm(true)}
            className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            删除
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center p-4 bg-red-50 border border-red-200 rounded-lg mb-6">
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

      {/* 标签页导航 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            {[
              { key: 'overview', label: '概览', icon: Eye },
              { key: 'logs', label: `执行日志 (${logs.length})`, icon: Activity },
              { key: 'screenshots', label: `截图 (${screenshots.length})`, icon: Image }
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key as any)}
                className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4 mr-2" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {/* 概览标签页 */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* 基本信息 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                    <FileText className="w-5 h-5 mr-2" />
                    基本信息
                  </h3>
                  
                  <div className="space-y-3">
                    <div className="flex items-start">
                      <Globe className="w-5 h-5 text-gray-400 mr-3 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-medium text-gray-700">目标网址</div>
                        <div className="text-sm text-gray-900 break-all">{task.url}</div>
                      </div>
                    </div>
                    
                    {task.description && (
                      <div className="flex items-start">
                        <FileText className="w-5 h-5 text-gray-400 mr-3 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-medium text-gray-700">任务描述</div>
                          <div className="text-sm text-gray-900">{task.description}</div>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex items-start">
                      <Calendar className="w-5 h-5 text-gray-400 mr-3 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-medium text-gray-700">创建时间</div>
                        <div className="text-sm text-gray-900">{formatDateTime(task.createdAt)}</div>
                      </div>
                    </div>
                    
                    <div className="flex items-start">
                      <Clock className="w-5 h-5 text-gray-400 mr-3 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-medium text-gray-700">最后更新</div>
                        <div className="text-sm text-gray-900">{formatDateTime(task.updatedAt)}</div>
                      </div>
                    </div>
                    
                    {executionDuration && (
                      <div className="flex items-start">
                        <RotateCcw className="w-5 h-5 text-gray-400 mr-3 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-medium text-gray-700">执行时长</div>
                          <div className="text-sm text-gray-900">{executionDuration}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                    <Activity className="w-5 h-5 mr-2" />
                    执行统计
                  </h3>
                  
                  <div className="space-y-4">
                    {/* 进度条 */}
                    {task.totalSteps > 0 && (
                      <div>
                        <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                          <span>执行进度</span>
                          <span>{task.currentStep}/{task.totalSteps} ({progressPercentage}%)</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div
                            className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                            style={{ width: `${progressPercentage}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                    
                    {/* 统计数据 */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-blue-50 rounded-lg p-4">
                        <div className="text-2xl font-bold text-blue-600">{logs.length}</div>
                        <div className="text-sm text-blue-600">执行日志</div>
                      </div>
                      <div className="bg-green-50 rounded-lg p-4">
                        <div className="text-2xl font-bold text-green-600">{screenshots.length}</div>
                        <div className="text-sm text-green-600">截图数量</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* 操作指令 */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">操作指令</h3>
                <div className="bg-gray-50 rounded-lg p-4">
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">{task.instructions}</pre>
                </div>
              </div>
            </div>
          )}
          
          {/* 执行日志标签页 */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">执行日志</h3>
                {logs.length > 0 && (
                  <button
                    onClick={handleExportLogs}
                    className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    导出日志
                  </button>
                )}
              </div>
              
              {logs.length === 0 ? (
                <div className="text-center py-12">
                  <Activity className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">暂无执行日志</h3>
                  <p className="text-gray-500">任务执行时会在这里显示详细日志</p>
                </div>
              ) : (
                <div className="bg-gray-900 rounded-lg p-4 max-h-96 overflow-y-auto">
                  <div className="space-y-2 font-mono text-sm">
                    {logs.map((log) => {
                      const levelConfig = LOG_LEVEL_CONFIG[log.level as keyof typeof LOG_LEVEL_CONFIG];
                      return (
                        <div key={log.id} className="flex items-start space-x-3">
                          <span className="text-gray-400 text-xs mt-0.5 flex-shrink-0">
                            {formatTime(log.timestamp)}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${
                            log.level === 'error' ? 'bg-red-900 text-red-200' :
                            log.level === 'warn' ? 'bg-yellow-900 text-yellow-200' :
                            log.level === 'info' ? 'bg-blue-900 text-blue-200' :
                            'bg-gray-800 text-gray-300'
                          }`}>
                            {log.level.toUpperCase()}
                          </span>
                          <span className={`flex-1 ${
                            log.level === 'error' ? 'text-red-400' :
                            log.level === 'warn' ? 'text-yellow-400' :
                            log.level === 'info' ? 'text-blue-400' :
                            'text-gray-300'
                          }`}>
                            {log.message}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* 截图标签页 */}
          {activeTab === 'screenshots' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">执行截图</h3>
                {screenshots.length > 0 && (
                  <button
                    onClick={handleDownloadAllScreenshots}
                    className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    下载所有截图
                  </button>
                )}
              </div>
              
              {screenshots.length === 0 ? (
                <div className="text-center py-12">
                  <Image className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">暂无截图</h3>
                  <p className="text-gray-500">任务执行时会自动保存关键步骤的截图</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {screenshots.map((screenshot) => (
                    <div key={screenshot.id} className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                      <img
                        src={screenshot.imageData}
                        alt={`步骤 ${screenshot.stepNumber}`}
                        className="w-full h-48 object-cover cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setSelectedScreenshot(screenshot)}
                      />
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-2">
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
                        <p className="text-xs text-gray-500 mb-2">
                          {formatDateTime(screenshot.timestamp)}
                        </p>
                        {screenshot.description && (
                          <p className="text-xs text-gray-600 line-clamp-3">
                            {screenshot.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* 截图预览模态框 */}
      {selectedScreenshot && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl max-h-full overflow-auto">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                步骤 {selectedScreenshot.stepNumber} - {formatDateTime(selectedScreenshot.timestamp)}
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
      
      {/* 删除确认对话框 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">确认删除</h3>
            <p className="text-gray-600 mb-6">
              确定要删除任务 "{task.title}" 吗？此操作无法撤销，相关的日志和截图也会被删除。
            </p>
            <div className="flex space-x-3">
              <button
                onClick={handleDeleteTask}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                删除
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}