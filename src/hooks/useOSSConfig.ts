/**
 * useOSSConfig
 *
 * 负责管理 OSS 连接配置的读取与持久化。
 * 该 Hook 仅与本地存储交互,不会发起任何网络请求,
 * 因此可以在应用启动的最早阶段调用以恢复用户上次的配置。
 */

import { useCallback, useState } from 'react';
import type { OSSConfig } from '@/types/oss';
import { clearOSSConfig, loadOSSConfig, saveOSSConfig } from '@/utils/storage';

/**
 * useOSSConfig 返回值
 */
export interface UseOSSConfigResult {
  /** 当前内存中的配置,未配置时为 null */
  config: OSSConfig | null;
  /** 保存配置(同时写入 localStorage) */
  setConfig: (config: OSSConfig) => void;
  /** 清空配置(同时移除 localStorage 中的缓存) */
  clearConfig: () => void;
}

/**
 * 管理 OSS 连接配置
 * 初始值会同步从 localStorage 中读取,避免页面闪烁
 */
export function useOSSConfig(): UseOSSConfigResult {
  // 使用懒初始化,只在首次渲染时读取一次 localStorage
  const [config, setConfigState] = useState<OSSConfig | null>(() => loadOSSConfig());

  /**
   * 更新配置:先更新内存 state,再写入 localStorage
   * 写入失败不会影响内存中的配置使用
   */
  const setConfig = useCallback((next: OSSConfig) => {
    setConfigState(next);
    saveOSSConfig(next);
  }, []);

  /**
   * 清空配置:用于"断开连接"操作
   */
  const clearConfig = useCallback(() => {
    setConfigState(null);
    clearOSSConfig();
  }, []);

  return { config, setConfig, clearConfig };
}
