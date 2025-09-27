/**
 * 日志工具类
 * 提供统一的日志格式，包含时间戳、级别、模块等信息
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

export interface LogOptions {
  module?: string;
  taskId?: string;
  userId?: string;
  requestId?: string;
}

/**
 * 格式化时间戳
 * @returns 格式化的时间字符串
 */
function formatTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

/**
 * 格式化日志消息
 * @param level 日志级别
 * @param message 日志消息
 * @param options 日志选项
 * @returns 格式化的日志字符串
 */
function formatLogMessage(level: LogLevel, message: string, options: LogOptions = {}): string {
  const timestamp = formatTimestamp();
  const { module, taskId, userId, requestId } = options;
  
  let logParts = [`[${timestamp}]`, `[${level}]`];
  
  if (module) {
    logParts.push(`[${module}]`);
  }
  
  if (taskId) {
    logParts.push(`[Task:${taskId}]`);
  }
  
  if (userId) {
    logParts.push(`[User:${userId}]`);
  }
  
  if (requestId) {
    logParts.push(`[Req:${requestId}]`);
  }
  
  logParts.push(message);
  
  return logParts.join(' ');
}

/**
 * 日志记录器类
 */
export class Logger {
  private module: string;
  
  constructor(module: string = 'APP') {
    this.module = module;
  }
  
  /**
   * 记录调试信息
   * @param message 日志消息
   * @param options 日志选项
   * @param data 附加数据
   */
  debug(message: string, options: LogOptions = {}, ...data: any[]): void {
    const formattedMessage = formatLogMessage(LogLevel.DEBUG, message, { ...options, module: this.module });
    console.log(formattedMessage, ...data);
  }
  
  /**
   * 记录一般信息
   * @param message 日志消息
   * @param options 日志选项
   * @param data 附加数据
   */
  info(message: string, options: LogOptions = {}, ...data: any[]): void {
    const formattedMessage = formatLogMessage(LogLevel.INFO, message, { ...options, module: this.module });
    console.log(formattedMessage, ...data);
  }
  
  /**
   * 记录警告信息
   * @param message 日志消息
   * @param options 日志选项
   * @param data 附加数据
   */
  warn(message: string, options: LogOptions = {}, ...data: any[]): void {
    const formattedMessage = formatLogMessage(LogLevel.WARN, message, { ...options, module: this.module });
    console.warn(formattedMessage, ...data);
  }
  
  /**
   * 记录错误信息
   * @param message 日志消息
   * @param options 日志选项
   * @param data 附加数据
   */
  error(message: string, options: LogOptions = {}, ...data: any[]): void {
    const formattedMessage = formatLogMessage(LogLevel.ERROR, message, { ...options, module: this.module });
    console.error(formattedMessage, ...data);
  }
  
  /**
   * 创建子日志记录器
   * @param subModule 子模块名称
   * @returns 新的日志记录器实例
   */
  child(subModule: string): Logger {
    return new Logger(`${this.module}:${subModule}`);
  }
}

/**
 * 创建日志记录器实例
 * @param module 模块名称
 * @returns 日志记录器实例
 */
export function createLogger(module: string): Logger {
  return new Logger(module);
}

// 默认日志记录器
export const logger = new Logger('APP');

// 各模块的日志记录器
export const serverLogger = createLogger('SERVER');
export const taskLogger = createLogger('TASK');
export const mcpLogger = createLogger('MCP');
export const browserLogger = createLogger('BROWSER');
export const wsLogger = createLogger('WEBSOCKET');
export const gptLogger = createLogger('GPT');
export const monitorLogger = createLogger('MONITOR');