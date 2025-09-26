/**
 * 任务列表页面
 * 显示所有已创建的浏览器自动化任务
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  List, 
  Play, 
  Pause, 
  Square, 
  Eye, 
  Trash2, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  Plus,
  Search,
  Filter
} from 'lucide-react';
import { indexedDBService, Task, TaskStatus } from '@/services/indexeddb-service';

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
 * 任务列表组件
 */
export default function TaskList() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  /**
   * 加载任务列表
   */
  const loadTasks = async () => {
    try {
      setLoading(true);
      const taskList = await indexedDBService.getAllTasks();
      // 按创建时间倒序排列
      taskList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setTasks(taskList);
      setError(null);
    } catch (err) {
      console.error('加载任务列表失败:', err);
      setError('加载任务列表失败');
    } finally {
      setLoading(false);
    }
  };

  /**
   * 删除任务
   * @param taskId 任务ID
   */
  const handleDeleteTask = async (taskId: string) => {
    try {
      await indexedDBService.deleteTask(taskId);
      await loadTasks(); // 重新加载列表
      setDeleteConfirm(null);
    } catch (err) {
      console.error('删除任务失败:', err);
      setError('删除任务失败');
    }
  };

  /**
   * 过滤任务列表
   */
  const filteredTasks = tasks.filter(task => {
    const matchesSearch = task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         task.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  /**
   * 格式化日期
   * @param dateString 日期字符串
   */
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  /**
   * 获取进度百分比
   * @param task 任务对象
   */
  const getProgressPercentage = (task: Task) => {
    if (task.totalSteps === 0) return 0;
    return Math.round((task.currentStep / task.totalSteps) * 100);
  };

  // 组件挂载时加载任务列表
  useEffect(() => {
    loadTasks();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">加载中...</span>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center">
          <List className="w-8 h-8 text-blue-600 mr-3" />
          <h1 className="text-3xl font-bold text-gray-900">任务列表</h1>
        </div>
        <button
          onClick={() => navigate('/')}
          className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5 mr-2" />
          创建新任务
        </button>
      </div>

      {/* 搜索和筛选 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* 搜索框 */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="搜索任务标题或描述..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          {/* 状态筛选 */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as TaskStatus | 'all')}
              className="pl-10 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white"
            >
              <option value="all">所有状态</option>
              {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                <option key={status} value={status}>{config.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center p-4 bg-red-50 border border-red-200 rounded-lg mb-6">
          <AlertCircle className="w-5 h-5 text-red-500 mr-3 flex-shrink-0" />
          <span className="text-red-700">{error}</span>
          <button
            onClick={loadTasks}
            className="ml-auto px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {/* 任务列表 */}
      {filteredTasks.length === 0 ? (
        <div className="text-center py-12">
          <List className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {tasks.length === 0 ? '还没有任务' : '没有找到匹配的任务'}
          </h3>
          <p className="text-gray-500 mb-6">
            {tasks.length === 0 ? '创建你的第一个自动化任务吧！' : '尝试调整搜索条件或筛选器'}
          </p>
          {tasks.length === 0 && (
            <button
              onClick={() => navigate('/')}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              创建任务
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTasks.map((task) => {
            const statusConfig = STATUS_CONFIG[task.status];
            const StatusIcon = statusConfig.icon;
            const progressPercentage = getProgressPercentage(task);

            return (
              <div
                key={task.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  {/* 任务信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 truncate mr-3">
                        {task.title}
                      </h3>
                      <div className={`flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color}`}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {statusConfig.label}
                      </div>
                    </div>
                    
                    {task.description && (
                      <p className="text-gray-600 mb-3 line-clamp-2">{task.description}</p>
                    )}
                    
                    <div className="flex items-center text-sm text-gray-500 space-x-4">
                      <span>目标: {task.url}</span>
                      <span>创建: {formatDate(task.createdAt)}</span>
                      {task.updatedAt !== task.createdAt && (
                        <span>更新: {formatDate(task.updatedAt)}</span>
                      )}
                    </div>
                    
                    {/* 进度条 */}
                    {task.totalSteps > 0 && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                          <span>执行进度</span>
                          <span>{task.currentStep}/{task.totalSteps} ({progressPercentage}%)</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${progressPercentage}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* 操作按钮 */}
                  <div className="flex items-center space-x-2 ml-4">
                    {/* 查看详情 */}
                    <button
                      onClick={() => navigate(`/tasks/${task.id}`)}
                      className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="查看详情"
                    >
                      <Eye className="w-5 h-5" />
                    </button>
                    
                    {/* 执行/继续 */}
                    {(task.status === TaskStatus.PENDING || task.status === TaskStatus.PAUSED || task.status === TaskStatus.FAILED) && (
                      <button
                        onClick={() => navigate(`/tasks/${task.id}/execute`)}
                        className="p-2 text-gray-600 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                        title="执行任务"
                      >
                        <Play className="w-5 h-5" />
                      </button>
                    )}
                    
                    {/* 删除 */}
                    <button
                      onClick={() => setDeleteConfirm(task.id)}
                      className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="删除任务"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 删除确认对话框 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">确认删除</h3>
            <p className="text-gray-600 mb-6">
              确定要删除这个任务吗？此操作无法撤销，相关的日志和截图也会被删除。
            </p>
            <div className="flex space-x-3">
              <button
                onClick={() => handleDeleteTask(deleteConfirm)}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                删除
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
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