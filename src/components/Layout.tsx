/**
 * 应用布局组件
 * 提供统一的页面布局和导航结构
 */

import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, List, Settings } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
}

/**
 * 导航菜单项接口
 */
interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
}

/**
 * 主布局组件
 * @param children 子组件内容
 */
export default function Layout({ children }: LayoutProps) {
  const location = useLocation();

  /**
   * 导航菜单配置
   */
  const navItems: NavItem[] = [
    {
      path: '/',
      label: '创建任务',
      icon: <Home className="w-5 h-5" />
    },
    {
      path: '/tasks',
      label: '任务列表',
      icon: <List className="w-5 h-5" />
    }
  ];

  /**
   * 检查当前路径是否为活动状态
   * @param path 路径
   */
  const isActivePath = (path: string): boolean => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航栏 */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo和标题 */}
            <div className="flex items-center">
              <img src="/favicon.svg" alt="Logo" className="w-8 h-8 mr-3" />
              <h1 className="text-xl font-bold text-gray-900">
                浏览器自动化工具
              </h1>
            </div>

            {/* 导航菜单 */}
            <nav className="flex space-x-8">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                    isActivePath(item.path)
                      ? 'text-blue-600 bg-blue-50'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* 主要内容区域 */}
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>

      {/* 底部信息 */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center text-sm text-gray-500">
            <div>
              <span>浏览器自动化工具 v1.0.0</span>
            </div>
            <div className="flex items-center space-x-4">
              <span>基于 GPT-4 和 Chrome DevTools</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}