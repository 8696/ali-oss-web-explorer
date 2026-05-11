/**
 * 阿里云 OSS Service
 *
 * 该文件是项目中唯一与 ali-oss SDK 直接交互的位置,
 * 上层 UI 与 Hooks 都通过这里暴露的纯函数访问对象存储能力。
 * 这样做的好处:
 *   1. SDK 升级或替换(例如改为 S3)只需修改本文件;
 *   2. 业务层无需关心 ali-oss 的细节(配置、错误归一化等);
 *   3. 便于编写单元测试时进行 mock。
 */

import OSS from 'ali-oss';
import type { OSSConfig, FileEntry, ListFilesResult } from '@/types/oss';
import { extractName } from '@/utils/format';

/**
 * 用于上传时回调进度的函数签名
 * @param percent 0~1 的进度值,内部会乘以 100 转成百分比展示
 */
export type ProgressHandler = (percent: number) => void;

/**
 * 归一化浏览器侧 OSS 错误信息
 *
 * 重点处理 ali-oss 在分片上传阶段常见的 CORS 报错:
 * 浏览器需要从响应头中读取 ETag,若 Bucket 的 CORS 没有把 ETag 加入
 * Expose-Headers,SDK 会直接抛出英文错误,这里转成更可执行的中文提示。
 *
 * @param err 原始异常对象
 * @returns 统一后的 Error 实例
 */
function normalizeOSSBrowserError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);

  if (/expose-headers/i.test(message) && /etag/i.test(message)) {
    return new Error(
      'Bucket 的 CORS 配置缺少 Expose-Headers: ETag。请到 OSS 控制台的 Bucket 跨域设置(CORS)中，将 Expose-Headers 增加 ETag，并确保允许 PUT、POST、GET、HEAD、DELETE 后重试。',
    );
  }

  return err instanceof Error ? err : new Error('OSS 操作失败');
}

/**
 * 创建一个 ali-oss 客户端实例
 * 客户端实例可以复用,无须每次操作都重新创建
 *
 * @param config OSS 连接配置
 * @returns ali-oss Client 实例
 */
export function createOSSClient(config: OSSConfig): OSS {
  return new OSS({
    accessKeyId: config.accessKeyId.trim(),
    accessKeySecret: config.accessKeySecret.trim(),
    bucket: config.bucket.trim(),
    region: config.region.trim(),
    endpoint: config.endpoint?.trim() || undefined,
    secure: config.secure ?? true,
    stsToken: config.stsToken?.trim() || undefined,
    // 在浏览器中默认走标准 OSS 路径,timeout 设置稍长以容忍上传大文件
    timeout: 120_000,
  });
}

/**
 * 验证 OSS 连接是否可用
 * 通过尝试列举一次桶内对象来探测,失败会抛出原始错误供上层提示
 *
 * @param client ali-oss 客户端
 */
export async function verifyConnection(client: OSS): Promise<void> {
  await client.list(
    {
      'max-keys': 1,
    },
    {},
  );
}

/**
 * 列举指定目录下的文件与子目录
 *
 * 实现要点:
 *   - 通过 `delimiter: '/'` 让 OSS 返回 CommonPrefixes(子目录)
 *   - prefix 为空字符串时表示根目录
 *   - 通过 marker 实现分页
 *
 * @param client    OSS 客户端
 * @param prefix    当前目录前缀(根目录传 '')
 * @param marker    分页游标
 * @param maxKeys   每页最大条数,默认 1000
 */
export async function listFiles(
  client: OSS,
  prefix = '',
  marker?: string,
  maxKeys = 1000,
): Promise<ListFilesResult> {
  const result = await client.list(
    {
      prefix: prefix || undefined,
      delimiter: '/',
      marker,
      'max-keys': maxKeys,
    },
    {},
  );

  // 1. 处理子目录:OSS 把同前缀的目录放在 prefixes(CommonPrefixes)
  const directories: FileEntry[] = (result.prefixes ?? []).map((dir) => ({
    key: dir,
    name: extractName(dir),
    path: dir,
    type: 'directory',
    size: 0,
  }));

  // 2. 处理文件:objects 返回当前层级的所有文件
  //    需要注意过滤掉 key === prefix 的占位文件(例如"创建目录"时手动写入的 0 字节对象)
  const files: FileEntry[] = (result.objects ?? [])
    .filter((obj) => obj.name !== prefix)
    .map((obj) => ({
      key: obj.name,
      name: extractName(obj.name),
      path: obj.name,
      type: 'file',
      size: obj.size ?? 0,
      lastModified: typeof obj.lastModified === 'string' ? obj.lastModified : (obj.lastModified as Date | undefined)?.toISOString(),
      storageClass: obj.storageClass,
      etag: obj.etag,
    }));

  return {
    // 目录排在前面,文件按名称升序
    entries: [...directories, ...files.sort((a, b) => a.name.localeCompare(b.name))],
    prefix,
    isTruncated: Boolean(result.isTruncated),
    nextMarker: result.nextMarker,
  };
}

/**
 * 自动遍历拉取指定目录下的全部分页结果
 *
 * 设计说明:
 *   - OSS 单次 list 最多返回 1000 条,当目录内容很多时会通过 isTruncated + nextMarker 提示翻页;
 *   - 该函数会持续调用 listFiles,直到当前目录的所有分页全部拉完;
 *   - 为了避免分页后目录/文件顺序错乱,这里分别聚合目录与文件,最终统一排序后返回。
 *
 * @param client  OSS 客户端
 * @param prefix  当前目录前缀(根目录传 '')
 * @param maxKeys 每页最大条数,默认 1000
 */
export async function listAllFiles(
  client: OSS,
  prefix = '',
  maxKeys = 1000,
): Promise<ListFilesResult> {
  const directoryMap = new Map<string, FileEntry>();
  const fileMap = new Map<string, FileEntry>();
  let marker: string | undefined = undefined;
  let lastPage: ListFilesResult | null = null;

  // 持续翻页直到当前目录全部取完
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await listFiles(client, prefix, marker, maxKeys);
    lastPage = page;

    page.entries.forEach((entry) => {
      if (entry.type === 'directory') {
        directoryMap.set(entry.key, entry);
        return;
      }
      fileMap.set(entry.key, entry);
    });

    if (!page.isTruncated || !page.nextMarker) {
      break;
    }
    marker = page.nextMarker;
  }

  const directories = Array.from(directoryMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  const files = Array.from(fileMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  return {
    entries: [...directories, ...files],
    prefix,
    isTruncated: false,
    nextMarker: lastPage?.nextMarker,
  };
}

/**
 * 创建一个"目录"
 *
 * OSS 是扁平的键值结构,没有真正意义上的目录。这里通过写入一个
 * 以 `/` 结尾的 0 字节对象来模拟,客户端列举时会自然把它识别为目录。
 *
 * @param client OSS 客户端
 * @param prefix 父目录前缀,例如 'a/b/'(根目录传 '')
 * @param folderName 用户输入的目录名,内部会自动去除非法字符
 */
export async function createDirectory(client: OSS, prefix: string, folderName: string): Promise<void> {
  const sanitized = folderName.trim().replace(/[\\/]+/g, '');
  if (!sanitized) {
    throw new Error('目录名称不能为空');
  }
  const objectKey = `${prefix}${sanitized}/`;
  // 内容为空 Buffer,Content-Type 标记为目录占位
  await client.put(objectKey, new Blob([], { type: 'application/x-directory' }));
}

/**
 * 上传单个文件
 *
 * 自动根据文件大小选择上传策略:
 *   - 小于 5 MB:使用 simple put,速度更快;
 *   - 大于 5 MB:使用 multipartUpload 分片上传,支持进度。
 *
 * @param client OSS 客户端
 * @param objectKey 目标对象 Key(包含目录前缀)
 * @param file 待上传的 File 对象
 * @param onProgress 进度回调,接收 0~1
 */
export async function uploadFile(
  client: OSS,
  objectKey: string,
  file: File,
  onProgress?: ProgressHandler,
): Promise<void> {
  const useMultipart = file.size > 5 * 1024 * 1024;

  try {
    if (useMultipart) {
      await client.multipartUpload(objectKey, file, {
        // 1 MB 分片
        partSize: 1024 * 1024,
        // ali-oss 进度回调签名:(percent, checkpoint, response)
        progress: async (p: number) => {
          onProgress?.(p);
        },
      });
    } else {
      // 小文件直接 put 上传
      await client.put(objectKey, file);
      onProgress?.(1);
    }
  } catch (err) {
    throw normalizeOSSBrowserError(err);
  }
}

/**
 * 生成对象的临时下载 URL
 *
 * 通过签名 URL 让浏览器直接发起下载请求,
 * 这样无需把整个文件读取到前端内存中。
 *
 * @param client OSS 客户端
 * @param objectKey 文件 Key
 * @param expires  签名有效期(秒),默认 60 秒
 * @returns 带签名的临时 URL
 */
export function getSignedUrl(client: OSS, objectKey: string, expires = 60): string {
  const fileName = extractName(objectKey);
  const encoded = encodeURIComponent(fileName);
  // RFC 5987: filename* 支持 UTF-8 编码的文件名; filename 作为 ASCII 兜底
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_');
  return client.signatureUrl(objectKey, {
    expires,
    response: {
      'content-disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    },
  });
}

/**
 * 生成对象的临时访问 URL（不强制下载，用于分享链接）
 *
 * @param client OSS 客户端
 * @param objectKey 文件 Key
 * @param expires  签名有效期(秒)
 * @returns 带签名的临时 URL
 */
export function getSignedAccessUrl(client: OSS, objectKey: string, expires: number): string {
  return client.signatureUrl(objectKey, { expires });
}

/**
 * 判断文件扩展名是否属于浏览器可直接预览的类型
 */
const PREVIEWABLE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico',
  'mp4', 'webm', 'ogg',
  'mp3', 'wav', 'aac', 'm4a', 'flac',
  'pdf',
  'txt', 'log', 'md', 'json', 'xml', 'csv', 'html', 'css', 'js', 'ts',
]);

export function isPreviewable(objectKey: string): boolean {
  const name = objectKey.split('/').pop() ?? '';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return PREVIEWABLE_EXTENSIONS.has(ext);
}

/**
 * 删除单个文件
 * @param client OSS 客户端
 * @param objectKey 目标文件 Key
 */
export async function deleteFile(client: OSS, objectKey: string): Promise<void> {
  await client.delete(objectKey);
}

/**
 * 批量删除多个条目
 * @param client OSS 客户端
 * @param entries 目标条目列表
 */
export async function deleteEntries(client: OSS, entries: FileEntry[]): Promise<void> {
  const dedupedEntries = Array.from(new Map(entries.map((entry) => [entry.path, entry])).values());
  const directoryPaths = dedupedEntries
    .filter((entry) => entry.type === 'directory')
    .map((entry) => entry.path);
  const fileKeys = dedupedEntries
    .filter((entry) => entry.type === 'file')
    .map((entry) => entry.path);

  for (const directoryPath of directoryPaths) {
    await deleteDirectory(client, directoryPath);
  }

  for (let index = 0; index < fileKeys.length; index += 1000) {
    const chunk = fileKeys.slice(index, index + 1000);
    if (chunk.length > 0) {
      await client.deleteMulti(chunk, { quiet: true });
    }
  }
}

/**
 * 递归删除目录下的所有对象
 *
 * 由于 OSS 无目录概念,需要:
 *   1. 用 prefix 列举该目录下所有对象(不使用 delimiter,递归列举)
 *   2. 调用 deleteMulti 批量删除(每次最多 1000 个)
 *   3. 循环直到没有更多对象
 *
 * @param client OSS 客户端
 * @param prefix 目录前缀,必须以 `/` 结尾
 */
export async function deleteDirectory(client: OSS, prefix: string): Promise<void> {
  if (!prefix.endsWith('/')) {
    throw new Error('目录前缀必须以 "/" 结尾');
  }
  let nextMarker: string | undefined = undefined;
  // 持续翻页直到列举完所有对象
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await client.list(
      {
        prefix,
        'max-keys': 1000,
        marker: nextMarker,
      },
      {},
    );
    const keys = (res.objects ?? []).map((o) => o.name);
    if (keys.length > 0) {
      await client.deleteMulti(keys, { quiet: true });
    }
    if (!res.isTruncated) break;
    nextMarker = res.nextMarker;
  }
}
