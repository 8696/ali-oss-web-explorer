/**
 * 通用格式化工具集
 * 统一处理文件大小、时间、路径等数据的展示
 */

import dayjs from 'dayjs';

/**
 * 将字节数转换为人类可读的容量字符串
 * @param bytes 字节数
 * @returns 例如 "1.23 MB"、"512 KB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0 || Number.isNaN(bytes)) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  // 计算指数等级,避免 log 在 bytes=0 时报错
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  // 保留两位小数,但当大于 100 时去掉小数避免冗余
  const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(2);
  return `${fixed} ${units[exponent]}`;
}

/**
 * 格式化时间字符串
 * @param input ISO 字符串或 Date 对象
 * @returns "YYYY-MM-DD HH:mm:ss"
 */
export function formatDateTime(input?: string | Date): string {
  if (!input) return '-';
  const d = dayjs(input);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : '-';
}

/**
 * 从对象 Key 中解析出最后一段名称
 * - 文件:"a/b/c.txt" -> "c.txt"
 * - 目录:"a/b/c/" -> "c"
 */
export function extractName(objectKey: string): string {
  if (!objectKey) return '';
  const trimmed = objectKey.endsWith('/') ? objectKey.slice(0, -1) : objectKey;
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/**
 * 将当前前缀拆分成面包屑可消费的片段
 * @param prefix 当前目录前缀,例如 "a/b/c/"
 * @returns [{label:'根目录',prefix:''},{label:'a',prefix:'a/'},...]
 */
export function splitPrefixToCrumbs(prefix: string): { label: string; prefix: string }[] {
  const crumbs: { label: string; prefix: string }[] = [{ label: '根目录', prefix: '' }];
  if (!prefix) return crumbs;
  const segments = prefix.split('/').filter(Boolean);
  let acc = '';
  segments.forEach((seg) => {
    acc += `${seg}/`;
    crumbs.push({ label: seg, prefix: acc });
  });
  return crumbs;
}

/**
 * 根据文件名识别简化的文件类型(用于挑选图标)
 * @param name 文件名
 */
export function guessFileCategory(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext)) return 'audio';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'excel';
  if (['ppt', 'pptx'].includes(ext)) return 'ppt';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return 'archive';
  if (['txt', 'md', 'log'].includes(ext)) return 'text';
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'scss', 'less', 'java', 'py', 'go', 'rb', 'php', 'c', 'cpp', 'h', 'sh', 'yml', 'yaml', 'xml'].includes(ext)) return 'code';
  return 'unknown';
}
