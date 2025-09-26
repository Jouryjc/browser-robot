/**
 * 首页 - 任务创建界面
 * 用户可以在此页面创建新的浏览器自动化任务
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Wand2, Play, AlertCircle, CheckCircle } from 'lucide-react';
import { indexedDBService, TaskStatus } from '@/services/indexeddb-service';

/**
 * 表单数据接口
 */
interface TaskFormData {
  title: string;
  description: string;
  url: string;
  instructions: string;
}

/**
 * 首页组件
 */
export default function Home() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<TaskFormData>({
    title: '',
    description: '',
    url: '',
    instructions: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  /**
   * 处理表单输入变化
   * @param field 字段名
   * @param value 字段值
   */
  const handleInputChange = (field: keyof TaskFormData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    // 清除错误状态
    if (error) setError(null);
    if (success) setSuccess(false);
  };

  /**
   * 验证表单数据
   */
  const validateForm = (): string | null => {
    if (!formData.title.trim()) {
      return '请输入任务标题';
    }
    if (!formData.url.trim()) {
      return '请输入目标网址';
    }
    if (!formData.instructions.trim()) {
      return '请输入操作指令';
    }
    
    // 验证URL格式
    try {
      new URL(formData.url);
    } catch {
      return '请输入有效的网址格式';
    }
    
    return null;
  };

  /**
   * 提交表单创建任务
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 验证表单
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      // 先调用后端API创建任务
      const response = await fetch('/api/tasks/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: formData.url.trim(),
          instructions: formData.instructions.trim(),
          options: {
            timeout: 30000,
            screenshot: true
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '创建任务失败');
      }

      const apiResult = await response.json();
      
      if (!apiResult.success) {
        throw new Error(apiResult.error || '创建任务失败');
      }

      // 将后端返回的任务数据存储到IndexedDB中
      const task = await indexedDBService.createTask({
        id: apiResult.data.taskId,
        title: formData.title.trim(),
        description: formData.description.trim(),
        url: formData.url.trim(),
        instructions: formData.instructions.trim(),
        status: TaskStatus.PENDING,
        progress: 0,
        totalSteps: apiResult.data.steps?.length || 0,
        currentStep: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      setSuccess(true);
      
      // 延迟跳转到任务执行页面
      setTimeout(() => {
        navigate(`/tasks/${task.id}/execute`);
      }, 1500);
      
    } catch (err) {
      console.error('创建任务失败:', err);
      setError(err instanceof Error ? err.message : '创建任务失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 重置表单
   */
  const handleReset = () => {
    setFormData({
      title: '',
      description: '',
      url: '',
      instructions: ''
    });
    setError(null);
    setSuccess(false);
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* 页面标题 */}
      <div className="text-center mb-8">
        <div className="flex items-center justify-center mb-4">
          <Wand2 className="w-12 h-12 text-blue-600 mr-4" />
          <h1 className="text-4xl font-bold text-gray-900">创建自动化任务</h1>
        </div>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          输入网址和操作指令，让AI帮你自动完成浏览器操作任务
        </p>
      </div>

      {/* 主要表单区域 */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        <div className="p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 任务标题 */}
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                任务标题 *
              </label>
              <input
                type="text"
                id="title"
                value={formData.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                placeholder="例如：自动填写表单并提交"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                disabled={isSubmitting}
              />
            </div>

            {/* 任务描述 */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                任务描述
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                placeholder="详细描述这个任务的目的和预期结果（可选）"
                rows={3}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none"
                disabled={isSubmitting}
              />
            </div>

            {/* 目标网址 */}
            <div>
              <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-2">
                目标网址 *
              </label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="url"
                  id="url"
                  value={formData.url}
                  onChange={(e) => handleInputChange('url', e.target.value)}
                  placeholder="https://example.com"
                  className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* 操作指令 */}
            <div>
              <label htmlFor="instructions" className="block text-sm font-medium text-gray-700 mb-2">
                操作指令 *
              </label>
              <textarea
                id="instructions"
                value={formData.instructions}
                onChange={(e) => handleInputChange('instructions', e.target.value)}
                placeholder={`用自然语言描述你想要执行的操作，例如：
1. 点击登录按钮
2. 输入用户名和密码
3. 点击提交按钮
4. 截图保存结果`}
                rows={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none"
                disabled={isSubmitting}
              />
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="flex items-center p-4 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-500 mr-3 flex-shrink-0" />
                <span className="text-red-700">{error}</span>
              </div>
            )}

            {/* 成功提示 */}
            {success && (
              <div className="flex items-center p-4 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-500 mr-3 flex-shrink-0" />
                <span className="text-green-700">任务创建成功！正在跳转到执行页面...</span>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex space-x-4 pt-4">
              <button
                type="submit"
                disabled={isSubmitting || success}
                className="flex-1 flex items-center justify-center px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    创建中...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-2" />
                    创建并执行任务
                  </>
                )}
              </button>
              
              <button
                type="button"
                onClick={handleReset}
                disabled={isSubmitting || success}
                className="px-6 py-3 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                重置
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 使用提示 */}
      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">使用提示</h3>
        <ul className="space-y-2 text-blue-800">
          <li className="flex items-start">
            <span className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
            <span>请使用自然语言描述你想要执行的操作，AI会自动解析并生成执行步骤</span>
          </li>
          <li className="flex items-start">
            <span className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
            <span>支持点击、输入、滚动、等待、截图等常见浏览器操作</span>
          </li>
          <li className="flex items-start">
            <span className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
            <span>任务执行过程中会自动保存日志和截图，方便查看执行结果</span>
          </li>
        </ul>
      </div>
    </div>
  );
}