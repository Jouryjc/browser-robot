/**
 * IndexedDB数据存储服务
 * 用于在浏览器端存储任务、日志和截图数据
 */

/**
 * 任务状态枚举
 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  STOPPED = 'stopped'
}

/**
 * 任务接口
 */
export interface Task {
  id: string;
  title: string;
  description?: string;
  url: string;
  instructions: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  progress: number;
  totalSteps: number;
  currentStep: number;
  error?: string;
}

/**
 * 任务日志接口
 */
export interface TaskLog {
  id: string;
  taskId: string;
  stepIndex: number;
  action: string;
  parameters: any;
  result: any;
  success: boolean;
  message: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  timestamp: string;
  duration: number;
  error?: string;
}

/**
 * 任务截图接口
 */
export interface TaskScreenshot {
  id: string;
  taskId: string;
  stepIndex: number;
  stepNumber: number;
  imageData: string;
  timestamp: string;
  description?: string;
}

/**
 * IndexedDB数据库配置
 */
const DB_NAME = 'BrowserAutomationDB';
const DB_VERSION = 1;
const STORES = {
  TASKS: 'tasks',
  LOGS: 'logs',
  SCREENSHOTS: 'screenshots'
};

/**
 * IndexedDB服务类
 */
export class IndexedDBService {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * 初始化数据库连接
   */
  async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB打开失败:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB连接成功');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createObjectStores(db);
      };
    });

    return this.initPromise;
  }

  /**
   * 创建对象存储
   * @param db 数据库实例
   */
  private createObjectStores(db: IDBDatabase): void {
    // 创建任务存储
    if (!db.objectStoreNames.contains(STORES.TASKS)) {
      const taskStore = db.createObjectStore(STORES.TASKS, { keyPath: 'id' });
      taskStore.createIndex('status', 'status', { unique: false });
      taskStore.createIndex('createdAt', 'createdAt', { unique: false });
      taskStore.createIndex('updatedAt', 'updatedAt', { unique: false });
    }

    // 创建日志存储
    if (!db.objectStoreNames.contains(STORES.LOGS)) {
      const logStore = db.createObjectStore(STORES.LOGS, { keyPath: 'id' });
      logStore.createIndex('taskId', 'taskId', { unique: false });
      logStore.createIndex('timestamp', 'timestamp', { unique: false });
      logStore.createIndex('taskId_stepIndex', ['taskId', 'stepIndex'], { unique: false });
    }

    // 创建截图存储
    if (!db.objectStoreNames.contains(STORES.SCREENSHOTS)) {
      const screenshotStore = db.createObjectStore(STORES.SCREENSHOTS, { keyPath: 'id' });
      screenshotStore.createIndex('taskId', 'taskId', { unique: false });
      screenshotStore.createIndex('timestamp', 'timestamp', { unique: false });
      screenshotStore.createIndex('taskId_stepIndex', ['taskId', 'stepIndex'], { unique: false });
    }
  }

  /**
   * 确保数据库已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.db) {
      await this.init();
    }
  }

  /**
   * 创建新任务
   * @param taskData 任务数据
   */
  async createTask(taskData: Omit<Task, 'createdAt' | 'updatedAt'> | Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Promise<Task> {
    await this.ensureInitialized();

    const task: Task = {
      ...taskData,
      id: (taskData as any).id || this.generateId(),
      createdAt: (taskData as any).createdAt || new Date().toISOString(),
      updatedAt: (taskData as any).updatedAt || new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORES.TASKS], 'readwrite');
      const store = transaction.objectStore(STORES.TASKS);
      const request = store.add(task);

      request.onsuccess = () => {
        console.log('任务创建成功:', task.id);
        resolve(task);
      };

      request.onerror = () => {
        console.error('任务创建失败:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 更新任务
   * @param taskId 任务ID
   * @param updates 更新数据
   */
  async updateTask(taskId: string, updates: Partial<Task>): Promise<Task> {
    await this.ensureInitialized();

    const existingTask = await this.getTask(taskId);
    if (!existingTask) {
      throw new Error(`任务不存在: ${taskId}`);
    }

    const updatedTask: Task = {
      ...existingTask,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORES.TASKS], 'readwrite');
      const store = transaction.objectStore(STORES.TASKS);
      const request = store.put(updatedTask);

      request.onsuccess = () => {
        console.log('任务更新成功:', taskId);
        resolve(updatedTask);
      };

      request.onerror = () => {
        console.error('任务更新失败:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 获取单个任务
   * @param taskId 任务ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORES.TASKS], 'readonly');
      const store = transaction.objectStore(STORES.TASKS);
      const request = store.get(taskId);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        console.error('获取任务失败:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 获取所有任务
   * @param status 可选的状态过滤
   */
  async getTasks(status?: TaskStatus): Promise<Task[]> {
    return this.getAllTasks(status);
  }

  /**
   * 获取所有任务（别名方法）
   * @param status 可选的状态过滤
   */
  async getAllTasks(status?: TaskStatus): Promise<Task[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORES.TASKS], 'readonly');
      const store = transaction.objectStore(STORES.TASKS);
      
      let request: IDBRequest;
      if (status) {
        const index = store.index('status');
        request = index.getAll(status);
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => {
        const tasks = request.result.sort((a: Task, b: Task) => 
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        resolve(tasks);
      };

      request.onerror = () => {
        console.error('获取任务列表失败:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 删除任务
   * @param taskId 任务ID
   */
  async deleteTask(taskId: string): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORES.TASKS, STORES.LOGS, STORES.SCREENSHOTS], 'readwrite');
      
      // 删除任务
      const taskStore = transaction.objectStore(STORES.TASKS);
      taskStore.delete(taskId);
      
      // 删除相关日志
      const logStore = transaction.objectStore(STORES.LOGS);
      const logIndex = logStore.index('taskId');
      const logRequest = logIndex.openCursor(taskId);
      logRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      
      // 删除相关截图
      const screenshotStore = transaction.objectStore(STORES.SCREENSHOTS);
      const screenshotIndex = screenshotStore.index('taskId');
      const screenshotRequest = screenshotIndex.openCursor(taskId);
      screenshotRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => {
        console.log('任务删除成功:', taskId);
        resolve();
      };

      transaction.onerror = () => {
        console.error('任务删除失败:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  /**
   * 添加任务日志
   * @param logData 日志数据
   */
  async addTaskLog(logData: Omit<TaskLog, 'id' | 'timestamp'>): Promise<TaskLog> {
    await this.ensureInitialized();

    const log: TaskLog = {
      ...logData,
      id: this.generateId(),
      timestamp: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORES.LOGS], 'readwrite');
      const store = transaction.objectStore(STORES.LOGS);
      const request = store.add(log);

      request.onsuccess = () => {
        resolve(log);
      };

      request.onerror = () => {
        console.error('添加任务日志失败:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 获取任务日志
   * @param taskId 任务ID
   */
  async getTaskLogs(taskId: string): Promise<TaskLog[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORES.LOGS], 'readonly');
      const store = transaction.objectStore(STORES.LOGS);
      const index = store.index('taskId');
      const request = index.getAll(taskId);

      request.onsuccess = () => {
        const logs = request.result.sort((a: TaskLog, b: TaskLog) => 
          a.stepIndex - b.stepIndex
        );
        resolve(logs);
      };

      request.onerror = () => {
        console.error('获取任务日志失败:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 添加任务截图
   * @param screenshotData 截图数据
   */
  async addTaskScreenshot(screenshotData: Omit<TaskScreenshot, 'id' | 'timestamp'>): Promise<TaskScreenshot> {
    await this.ensureInitialized();

    const screenshot: TaskScreenshot = {
      ...screenshotData,
      id: this.generateId(),
      timestamp: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORES.SCREENSHOTS], 'readwrite');
      const store = transaction.objectStore(STORES.SCREENSHOTS);
      const request = store.add(screenshot);

      request.onsuccess = () => {
        resolve(screenshot);
      };

      request.onerror = () => {
        console.error('添加任务截图失败:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 获取任务截图
   * @param taskId 任务ID
   */
  async getTaskScreenshots(taskId: string): Promise<TaskScreenshot[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORES.SCREENSHOTS], 'readonly');
      const store = transaction.objectStore(STORES.SCREENSHOTS);
      const index = store.index('taskId');
      const request = index.getAll(taskId);

      request.onsuccess = () => {
        const screenshots = request.result.sort((a: TaskScreenshot, b: TaskScreenshot) => 
          a.stepIndex - b.stepIndex
        );
        resolve(screenshots);
      };

      request.onerror = () => {
        console.error('获取任务截图失败:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 清除任务日志
   */
  async clearTaskLogs(taskId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['logs'], 'readwrite');
      const store = transaction.objectStore('logs');
      const index = store.index('taskId');
      const request = index.openCursor(taskId);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => {
        reject(new Error('清除任务日志失败'));
      };
    });
  }

  /**
   * 清除任务截图
   */
  async clearTaskScreenshots(taskId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['screenshots'], 'readwrite');
      const store = transaction.objectStore('screenshots');
      const index = store.index('taskId');
      const request = index.openCursor(taskId);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => {
        reject(new Error('清除任务截图失败'));
      };
    });
  }

  /**
   * 清空所有数据
   */
  async clearAllData(): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORES.TASKS, STORES.LOGS, STORES.SCREENSHOTS], 'readwrite');
      
      transaction.objectStore(STORES.TASKS).clear();
      transaction.objectStore(STORES.LOGS).clear();
      transaction.objectStore(STORES.SCREENSHOTS).clear();

      transaction.oncomplete = () => {
        console.log('所有数据已清空');
        resolve();
      };

      transaction.onerror = () => {
        console.error('清空数据失败:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}

// 导出单例实例
export const indexedDBService = new IndexedDBService();