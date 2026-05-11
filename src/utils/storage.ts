/**
 * 本地存储工具
 * 封装 localStorage 读写并附带类型安全和错误隔离,避免序列化异常打断主流程
 */

import type { OSSConfig } from '@/types/oss';

/** localStorage 中保存 OSS 配置使用的 key */
const OSS_CONFIG_KEY = 'ali-oss-web::config';

/**
 * 读取已保存的 OSS 配置
 * 解析失败或不存在时返回 null
 */
export function loadOSSConfig(): OSSConfig | null {
  try {
    const raw = localStorage.getItem(OSS_CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OSSConfig;
  } catch (err) {
    // 容错:可能是 JSON 解析错误或浏览器禁用 storage
    console.warn('[storage] 读取 OSS 配置失败', err);
    return null;
  }
}

/**
 * 持久化 OSS 配置
 * @param config OSS 配置
 */
export function saveOSSConfig(config: OSSConfig): void {
  try {
    localStorage.setItem(OSS_CONFIG_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('[storage] 写入 OSS 配置失败', err);
  }
}

/**
 * 删除已保存的 OSS 配置
 * 用于"断开连接"按钮
 */
export function clearOSSConfig(): void {
  try {
    localStorage.removeItem(OSS_CONFIG_KEY);
  } catch (err) {
    console.warn('[storage] 清除 OSS 配置失败', err);
  }
}
