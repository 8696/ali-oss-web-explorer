/**
 * useOSSFiles
 *
 * 文件浏览器的状态中心:
 *   - 维护当前所在目录(prefix)与对应的文件列表;
 *   - 提供导航(navigate)、刷新(refresh)、删除、新建目录等操作方法;
 *   - 当 client 变化时自动重置并重新拉取列表。
 *
 * 上传任务由独立的 useUploadTasks Hook 管理,避免单个 Hook 责任过多。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type OSS from 'ali-oss';
import type { FileEntry } from '@/types/oss';
import {
  createDirectory as svcCreateDirectory,
  deleteEntries as svcDeleteEntries,
  listAllFiles as svcListAllFiles,
} from '@/services/oss';

/** 从当前浏览器 URL 的 ?dir= 参数中读取目录前缀 */
function readDirFromUrl(): string {
  const dir = new URLSearchParams(window.location.search).get('dir') ?? '';
  return dir === '' ? '' : dir.endsWith('/') ? dir : `${dir}/`;
}

/** 将目录前缀写入浏览器 URL（replace 模式，用于 popstate 回恢复） */
function replaceDirToUrl(dir: string) {
  const url = new URL(window.location.href);
  if (dir) {
    url.searchParams.set('dir', dir);
  } else {
    url.searchParams.delete('dir');
  }
  window.history.replaceState(null, '', url);
}

/** 将目录前缀写入浏览器 URL（push 模式，用于主动导航，可被后退按钮回退） */
function pushDirToUrl(dir: string) {
  const url = new URL(window.location.href);
  if (dir) {
    url.searchParams.set('dir', dir);
  } else {
    url.searchParams.delete('dir');
  }
  window.history.pushState(null, '', url);
}

/**
 * Hook 输出
 */
export interface UseOSSFilesResult {
  /** 当前所在目录前缀,根目录为 '' */
  prefix: string;
  /** 当前目录下的文件与子目录 */
  entries: FileEntry[];
  /** 是否正在加载列表 */
  loading: boolean;
  /** 当前列表加载过程中产生的错误信息 */
  error: string | null;
  /** 跳转到指定目录前缀 */
  navigate: (nextPrefix: string) => void;
  /** 刷新当前目录 */
  refresh: () => Promise<void>;
  /** 在当前目录下新建子目录 */
  createFolder: (name: string) => Promise<void>;
  /** 删除一个文件或目录条目 */
  removeEntry: (entry: FileEntry) => Promise<void>;
  /** 批量删除多个文件或目录条目 */
  removeEntries: (entries: FileEntry[]) => Promise<void>;
}

/**
 * 维护文件浏览器的状态
 *
 * @param client 已经建立的 OSS 客户端,未连接时传 null
 */
export function useOSSFiles(client: OSS | null): UseOSSFilesResult {
  /** 当前所在目录前缀（初始值从 URL ?dir= 参数恢复） */
  const [prefix, setPrefix] = useState<string>(readDirFromUrl);
  /** 当前目录下的条目 */
  const [entries, setEntries] = useState<FileEntry[]>([]);
  /** 加载状态 */
  const [loading, setLoading] = useState<boolean>(false);
  /** 错误信息 */
  const [error, setError] = useState<string | null>(null);
  /**
   * 递增请求令牌
   * 自动翻页会让单次请求持续更久,这里用 token 丢弃过期目录请求结果,
   * 防止用户快速切目录时旧目录的数据覆盖新目录。
   */
  const requestTokenRef = useRef(0);

  /**
   * 加载指定目录的内容
   * 抽成独立函数以便在 prefix/client 变化或显式 refresh 时复用
   */
  const loadDirectory = useCallback(
    async (targetClient: OSS, targetPrefix: string) => {
      requestTokenRef.current += 1;
      const currentToken = requestTokenRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await svcListAllFiles(targetClient, targetPrefix);
        if (currentToken !== requestTokenRef.current) return;
        setEntries(result.entries);
      } catch (err) {
        if (currentToken !== requestTokenRef.current) return;
        const message = err instanceof Error ? err.message : '加载文件列表失败';
        setError(message);
        setEntries([]);
      } finally {
        if (currentToken !== requestTokenRef.current) return;
        setLoading(false);
      }
    },
    [],
  );

  /**
   * 当 client 或 prefix 变化时,自动重新拉取列表
   * client 变化通常发生在重新连接或断开连接时
   */
  useEffect(() => {
    if (!client) {
      requestTokenRef.current += 1;
      // 断开连接时清空状态,避免脏数据残留
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }
    void loadDirectory(client, prefix);
  }, [client, prefix, loadDirectory]);

  /**
   * 监听浏览器前进/后退，恢复对应目录
   */
  useEffect(() => {
    const onPopState = () => {
      const dir = readDirFromUrl();
      setPrefix(dir);
      replaceDirToUrl(dir);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  /**
   * 跳转到指定目录
   * 通过修改 prefix 触发上面的 effect 重新加载
   * 同时将目录路径写入浏览器 URL，刷新后可恢复
   */
  const navigate = useCallback((nextPrefix: string) => {
    // 标准化:目录前缀必须以 / 结尾,根目录为空字符串
    const normalized = nextPrefix === '' ? '' : nextPrefix.endsWith('/') ? nextPrefix : `${nextPrefix}/`;
    if (normalized === prefix) return;
    setPrefix(normalized);
    pushDirToUrl(normalized);
  }, [prefix]);

  /**
   * 手动刷新当前目录
   */
  const refresh = useCallback(async () => {
    if (!client) return;
    await loadDirectory(client, prefix);
  }, [client, prefix, loadDirectory]);

  /**
   * 在当前目录新建一个子目录
   * 成功后会自动刷新列表
   */
  const createFolder = useCallback(
    async (name: string) => {
      if (!client) throw new Error('未连接 OSS');
      await svcCreateDirectory(client, prefix, name);
      await loadDirectory(client, prefix);
    },
    [client, prefix, loadDirectory],
  );

  /**
   * 批量删除文件或目录
   * 成功后仅刷新一次当前目录
   */
  const removeEntries = useCallback(
    async (targetEntries: FileEntry[]) => {
      if (!client) throw new Error('未连接 OSS');
      if (targetEntries.length === 0) return;
      requestTokenRef.current += 1;
      const currentToken = requestTokenRef.current;
      setLoading(true);
      setError(null);
      try {
        await svcDeleteEntries(client, targetEntries);
        await loadDirectory(client, prefix);
      } finally {
        if (currentToken !== requestTokenRef.current) return;
        setLoading(false);
      }
    },
    [client, prefix, loadDirectory],
  );

  /**
   * 删除文件或目录
   * 目录会递归清空后再"消失",过程中表格保持 loading 状态
   */
  const removeEntry = useCallback(
    async (entry: FileEntry) => {
      await removeEntries([entry]);
    },
    [removeEntries],
  );

  return {
    prefix,
    entries,
    loading,
    error,
    navigate,
    refresh,
    createFolder,
    removeEntry,
    removeEntries,
  };
}
