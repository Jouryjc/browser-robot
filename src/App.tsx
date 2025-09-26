import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import TaskList from "@/pages/TaskList";
import TaskExecute from "@/pages/TaskExecute";
import TaskDetail from "@/pages/TaskDetail";
import Layout from "@/components/Layout";
import ErrorBoundary from "@/components/ErrorBoundary";

/**
 * 主应用组件
 * 配置路由并使用错误边界保护应用
 */
export default function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Layout>
          <ErrorBoundary>
            <Routes>
              {/* 首页 - 任务创建界面 */}
              <Route path="/" element={<Home />} />
              
              {/* 任务列表页面 */}
              <Route path="/tasks" element={<TaskList />} />
              
              {/* 任务执行页面 */}
              <Route 
                path="/tasks/:id/execute" 
                element={
                  <ErrorBoundary>
                    <TaskExecute />
                  </ErrorBoundary>
                } 
              />
              
              {/* 任务详情页面 */}
              <Route path="/tasks/:id" element={<TaskDetail />} />
              
              {/* 404页面 */}
              <Route path="*" element={
                <div className="flex items-center justify-center min-h-screen">
                  <div className="text-center">
                    <h1 className="text-4xl font-bold text-gray-800 mb-4">404</h1>
                    <p className="text-gray-600 mb-4">页面未找到</p>
                    <a href="/" className="text-blue-600 hover:text-blue-800 underline">
                      返回首页
                    </a>
                  </div>
                </div>
              } />
            </Routes>
          </ErrorBoundary>
        </Layout>
      </Router>
    </ErrorBoundary>
  );
}
