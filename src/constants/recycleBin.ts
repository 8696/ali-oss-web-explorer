/**
 * 回收站相关常量与纯函数（无 ali-oss 依赖，供 UI 与 service 共用）
 *
 * 约定：系统回收站为**桶根**下名为 {@link RECYCLE_BIN_FOLDER} 的目录，即对象 Key 前缀恒为
 * `回收站/`。其它路径下同名文件夹（如 `foo/回收站/`）不视为系统回收站。
 */

import type { FileEntry } from '@/types/oss';

/** 删除前备份使用的桶内根目录名（Key 前缀段，不含首尾斜杠），须与列表展示名一致 */
export const RECYCLE_BIN_FOLDER = '回收站';

/** 桶根系统回收站目录前缀（以 `/` 结尾），与 OSS Key 前缀一致 */
export const ROOT_RECYCLE_BIN_PREFIX = `${RECYCLE_BIN_FOLDER}/`;

/**
 * 将目录条目路径规范为以 `/` 结尾的前缀
 */
export function normalizeDirectoryPrefix(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

/**
 * 判断 OSS Key 是否位于桶根「回收站」目录之下（其下删除不再复制到回收站）
 */
export function isObjectKeyUnderRecycleBin(objectKey: string): boolean {
  return objectKey.startsWith(ROOT_RECYCLE_BIN_PREFIX);
}

/**
 * 判断列表条目是否为桶根系统「回收站」目录（非任意层级下同名的普通文件夹）
 */
export function isRecycleBinDirectoryEntry(entry: Pick<FileEntry, 'type' | 'name' | 'path'>): boolean {
  if (entry.type !== 'directory' || entry.name !== RECYCLE_BIN_FOLDER) return false;
  return normalizeDirectoryPrefix(entry.path) === ROOT_RECYCLE_BIN_PREFIX;
}
