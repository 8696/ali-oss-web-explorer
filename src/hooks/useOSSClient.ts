/**
 * useOSSClient
 *
 * 基于 OSSConfig 创建并维护 ali-oss 客户端实例的 Hook。
 * 同时承担"连接验证"职责,确保暴露给上层的 client 始终是一个可用的实例。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type OSS from 'ali-oss';
import type { OSSConfig } from '@/types/oss';
import { createOSSClient, verifyConnection } from '@/services/oss';

/**
 * Hook 输出
 */
export interface UseOSSClientResult {
  /** 已建立的客户端,未连接或断开时为 null */
  client: OSS | null;
  /** 是否正在验证连接 */
  connecting: boolean;
  /** 连接是否已建立 */
  connected: boolean;
  /** 上一次连接出错的信息(若有) */
  error: string | null;
}

/**
 * 维护 ali-oss 客户端
 *
 * 工作流程:
 *   1. 当 config 变化时,重新创建 client 并发起一次轻量 list 调用做验证;
 *   2. 验证成功后将 client 暴露给上层使用;
 *   3. 验证失败时清空 client,并将错误信息保存在 error 字段。
 *
 * 注:这里使用 ref 来保存"最新一次发起请求的 token",
 *     用于在配置快速变更时丢弃过期请求的结果,防止竞态。
 *
 * @param config OSS 连接配置;为 null 表示未配置
 */
export function useOSSClient(config: OSSConfig | null): UseOSSClientResult {
  // 内部当前已通过验证的 client
  const [client, setClient] = useState<OSS | null>(null);
  // 正在执行验证请求
  const [connecting, setConnecting] = useState(false);
  // 错误信息
  const [error, setError] = useState<string | null>(null);
  // 用于丢弃过期请求结果的递增 token
  const requestTokenRef = useRef(0);

  /**
   * 副作用:配置变化时重新尝试连接
   */
  useEffect(() => {
    if (!config) {
      // 无配置时重置全部状态
      setClient(null);
      setError(null);
      setConnecting(false);
      return;
    }

    // 生成本次请求 token,后续异步回调以此判断结果是否仍有效
    requestTokenRef.current += 1;
    const currentToken = requestTokenRef.current;

    // 先清除旧 client，避免重连期间仍可操作旧 Bucket
    setClient(null);
    const next = createOSSClient(config);
    setConnecting(true);
    // 不在此处清空 error:避免「有本地配置、校验尚未返回」或「失败后重试」时瞬间没有 connectError,连接弹窗误关/误开

    verifyConnection(next)
      .then(() => {
        // 若期间又触发了新的连接,丢弃旧结果
        if (currentToken !== requestTokenRef.current) return;
        setError(null);
        setClient(next);
      })
      .catch((err: unknown) => {
        if (currentToken !== requestTokenRef.current) return;
        setClient(null);
        // 优先取 SDK 返回的可读 message
        const message = err instanceof Error ? err.message : '连接失败,请检查配置';
        setError(message);
      })
      .finally(() => {
        if (currentToken !== requestTokenRef.current) return;
        setConnecting(false);
      });
  }, [config]);

  /**
   * connected:在 client 实例存在且没有错误时为 true
   * 这里用 useMemo 缓存,避免每次渲染都创建新引用
   */
  const connected = useMemo(() => Boolean(client) && !error, [client, error]);

  return { client, connecting, connected, error };
}
