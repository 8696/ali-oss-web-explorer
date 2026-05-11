/**
 * useUploadTasks
 *
 * 上传任务管理 Hook:
 *   - 维护一个上传任务队列(UploadTask[]);
 *   - 提供 enqueue/cancel/clearCompleted 等方法供 UI 控制;
 *   - 内部串行触发上传(同一时间最多 N 个并行,避免占满浏览器连接数)。
 *
 * 与 useOSSFiles 拆分的原因:
 *   1. 上传任务需要长生命周期(切换目录后仍需继续);
 *   2. 责任单一,便于后续扩展(例如断点续传、重试)。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type OSS from 'ali-oss';
import type { UploadTask } from '@/types/oss';
import { uploadFile as svcUploadFile } from '@/services/oss';

/** 同一时刻允许同时上传的最大文件数 */
const MAX_CONCURRENCY = 10;

export interface UploadBatchResult {
  /** 本批次任务总数 */
  total: number;
  /** 成功数量 */
  successCount: number;
  /** 失败数量 */
  errorCount: number;
  /** 本批次全部任务 */
  tasks: UploadTask[];
}

export interface UseUploadTasksOptions {
  /** 单个批次全部结束后的回调(用于统一刷新列表与统一提示) */
  onBatchComplete?: (result: UploadBatchResult) => void;
}

export interface UseUploadTasksResult {
  /** 当前所有的上传任务 */
  tasks: UploadTask[];
  /** 是否还有任务在执行中 */
  uploading: boolean;
  /** 添加一组文件到上传队列 */
  enqueue: (files: File[], targetPrefix: string) => void;
  /** 清除已完成(成功/失败/取消)的任务 */
  clearCompleted: () => void;
}

/**
 * 生成简单的 UUID,用于上传任务的 ID
 * 优先使用 crypto.randomUUID,降级使用时间戳 + 随机数
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 管理上传任务队列
 *
 * @param client OSS 客户端,未连接时传 null
 * @param options 配置项
 */
export function useUploadTasks(client: OSS | null, options: UseUploadTasksOptions = {}): UseUploadTasksResult {
  const { onBatchComplete } = options;
  // 任务列表
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  // 当前正在上传的任务 ID 集合,用 ref 是为了在 effect 内同步读写最新值
  const inFlightRef = useRef<Set<string>>(new Set());
  // 当前仍未完成的批次 ID 集合
  const activeBatchIdsRef = useRef<Set<string>>(new Set());
  // 记录每个批次包含的任务 ID,用于批次结束时汇总状态
  const batchTaskIdsRef = useRef<Map<string, string[]>>(new Map());
  // onBatchComplete 的最新引用,避免闭包陷阱
  const batchCompleteHandlerRef = useRef(onBatchComplete);
  useEffect(() => {
    batchCompleteHandlerRef.current = onBatchComplete;
  }, [onBatchComplete]);

  /**
   * 把队列中状态为 waiting 的任务挑出来,根据并发上限调度它们开始上传
   * 每次任务状态变化都会触发该 effect 重新调度
   */
  useEffect(() => {
    if (!client) return;
    // 找出可以开始上传的任务
    const startable = tasks.filter(
      (t) => t.status === 'waiting' && !inFlightRef.current.has(t.id),
    );
    // 计算剩余并发额度
    const slots = MAX_CONCURRENCY - inFlightRef.current.size;
    if (slots <= 0 || startable.length === 0) return;
    const toStart = startable.slice(0, slots);

    toStart.forEach((task) => {
      inFlightRef.current.add(task.id);
      // 把状态改成 uploading
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'uploading' } : t)));
      // 真正发起上传
      svcUploadFile(client, task.objectKey, task.file, (percent) => {
        // 进度回调:同步更新进度,做了最小变更检查避免渲染抖动
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== task.id) return t;
            const next = Math.min(100, Math.round(percent * 100));
            return next === t.progress ? t : { ...t, progress: next };
          }),
        );
      })
        .then(() => {
          // 成功:仅更新当前任务状态,不立刻刷新列表
          setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: 'success', progress: 100 } : t)));
        })
        .catch((err: unknown) => {
          // 失败:记录错误信息
          const message = err instanceof Error ? err.message : '上传失败';
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, status: 'error', errorMessage: message } : t)),
          );
        })
        .finally(() => {
          inFlightRef.current.delete(task.id);
          // 主动触发一次状态更新让 effect 重新调度后续任务
          // 这里通过空 set 来"踢一脚"调度循环
          setTasks((prev) => [...prev]);
        });
    });
  }, [client, tasks]);

  /**
   * 批次完成检测
   *
   * 批次定义:一次 enqueue 调用加入的一组文件。
   * 当该批次中的全部任务都进入 success/error/canceled 终态后,
   * 只触发一次 onBatchComplete 回调。
   */
  useEffect(() => {
    if (activeBatchIdsRef.current.size === 0) return;

    activeBatchIdsRef.current.forEach((batchId) => {
      const taskIds = batchTaskIdsRef.current.get(batchId) ?? [];
      if (taskIds.length === 0) {
        activeBatchIdsRef.current.delete(batchId);
        batchTaskIdsRef.current.delete(batchId);
        return;
      }

      const batchTasks = taskIds
        .map((taskId) => tasks.find((task) => task.id === taskId))
        .filter((task): task is UploadTask => Boolean(task));

      if (batchTasks.length !== taskIds.length) {
        return;
      }

      const allDone = batchTasks.every(
        (task) => task.status === 'success' || task.status === 'error' || task.status === 'canceled',
      );

      if (!allDone) {
        return;
      }

      activeBatchIdsRef.current.delete(batchId);
      batchTaskIdsRef.current.delete(batchId);

      const successCount = batchTasks.filter((task) => task.status === 'success').length;
      const errorCount = batchTasks.filter((task) => task.status === 'error').length;

      batchCompleteHandlerRef.current?.({
        total: batchTasks.length,
        successCount,
        errorCount,
        tasks: batchTasks,
      });
    });
  }, [tasks]);

  /**
   * 添加文件到上传队列
   * @param files 浏览器原生 File 对象数组
   * @param targetPrefix 上传到哪个目录(以 / 结尾,根目录为 '')
   */
  const enqueue = useCallback((files: File[], targetPrefix: string) => {
    if (files.length === 0) return;
    const batchId = generateId();
    const newTasks: UploadTask[] = files.map((file) => ({
      id: generateId(),
      file,
      objectKey: `${targetPrefix}${file.name}`,
      progress: 0,
      status: 'waiting',
      batchId,
    }));

    activeBatchIdsRef.current.add(batchId);
    batchTaskIdsRef.current.set(
      batchId,
      newTasks.map((task) => task.id),
    );

    setTasks((prev) => [...newTasks, ...prev]);
  }, []);

  /**
   * 清除已完成的任务(成功/失败/取消)
   */
  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === 'waiting' || t.status === 'uploading'));
  }, []);

  /**
   * 是否还有任务在执行中(包括等待与上传中)
   */
  const uploading = tasks.some((t) => t.status === 'waiting' || t.status === 'uploading');

  return { tasks, uploading, enqueue, clearCompleted };
}
