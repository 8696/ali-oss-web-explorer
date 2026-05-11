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
import type { OSSConfig, FileEntry, ListFilesResult, RenameDirectoryProgress } from '@/types/oss';
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
 * 清洗重命名时用户输入的「最后一段」名称(仅文件名或文件夹名,不含父路径)
 *
 * 规则与「新建文件夹」一致:去掉首尾空白、去掉路径分隔符、拒绝 `.` / `..`、限制长度。
 * 若用户粘贴了带路径的字符串,`replace(/[\\/]+/g, '')` 会去掉其中的 `/` `\`,避免误写成子路径。
 *
 * @param raw 表单中的原始输入
 * @returns 可用于拼接父前缀的合法名称片段
 * @throws 名称为空、无效或超长时抛出带中文说明的 Error
 */
function sanitizeEntryBaseName(raw: string): string {
  const sanitized = raw.trim().replace(/[\\/]+/g, '');
  if (!sanitized) {
    throw new Error('名称不能为空');
  }
  if (sanitized === '.' || sanitized === '..') {
    throw new Error('名称无效');
  }
  if (sanitized.length > 255) {
    throw new Error('名称不能超过 255 个字符');
  }
  return sanitized;
}

/**
 * 从条目的完整 OSS Key 反推「父目录前缀」,用于与新名称拼接成目标 Key
 *
 * - 文件 `a/b/c.txt` → 父前缀 `a/b/`, 新 Key 为 `a/b/<新名称>`
 * - 目录 `a/b/c/`  → 父前缀 `a/b/`, 新前缀为 `a/b/<新名称>/`
 * - 根下对象 `readme.txt` → 父前缀 ``
 *
 * @param entry 当前列表中的文件或目录条目
 */
function parentPrefixFromEntry(entry: FileEntry): string {
  if (entry.type === 'directory') {
    const trimmed = entry.path.endsWith('/') ? entry.path.slice(0, -1) : entry.path;
    const idx = trimmed.lastIndexOf('/');
    return idx === -1 ? '' : trimmed.slice(0, idx + 1);
  }
  const idx = entry.path.lastIndexOf('/');
  return idx === -1 ? '' : entry.path.slice(0, idx + 1);
}

/**
 * 确认「目标文件 Key」尚不存在,避免 copy 覆盖已有对象
 *
 * 使用 head; 404/NoSuchKey 视为可用,其余错误原样抛出(网络、权限等)。
 *
 * @param client OSS 客户端
 * @param objectKey 即将写入的完整对象 Key(无尾斜杠)
 * @throws 对象已存在时抛出「已存在同名文件」
 */
async function assertFileDestinationFree(client: OSS, objectKey: string): Promise<void> {
  try {
    await client.head(objectKey);
    throw new Error('已存在同名文件');
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string; message?: string };
    if (e?.message === '已存在同名文件') {
      throw err;
    }
    if (e?.status === 404 || e?.code === 'NoSuchKey') {
      return;
    }
    throw err instanceof Error ? err : new Error('OSS 操作失败');
  }
}

/**
 * 确认「目标目录前缀」下可以安全创建新目录树,不与已有对象冲突
 *
 * 分两步:
 * 1. `head(去掉尾斜杠的 Key)` — 若存在与「目录同名且无尾斜杠」的文件(如 `foo` 与 `foo/` 并存场景),禁止重命名;
 * 2. `list(prefix=dirPrefix, max-keys=1)` — 若前缀下已有任意对象或 CommonPrefix,说明目标已被占用或已有内容。
 *
 * @param client OSS 客户端
 * @param dirPrefix 目录前缀,必须以 `/` 结尾
 * @throws 目标处已有文件、文件夹或对象时抛出中文 Error
 */
/** 删除对象;不存在(404/NoSuchKey)时静默成功,其余错误抛出 */
async function deleteObjectIgnoreNotFound(client: OSS, objectKey: string): Promise<void> {
  try {
    await client.delete(objectKey);
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string };
    if (e?.status === 404 || e?.code === 'NoSuchKey') {
      return;
    }
    throw err instanceof Error ? err : new Error('OSS 操作失败');
  }
}

async function assertDirectoryDestinationFree(client: OSS, dirPrefix: string): Promise<void> {
  if (!dirPrefix.endsWith('/')) {
    throw new Error('目录前缀必须以 "/" 结尾');
  }
  const withoutSlash = dirPrefix.slice(0, -1);
  try {
    await client.head(withoutSlash);
    throw new Error('已存在同名的文件');
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string; message?: string };
    if (e?.message === '已存在同名的文件') {
      throw err;
    }
    if (e?.status === 404 || e?.code === 'NoSuchKey') {
      /* 目标处无同名文件,继续检查前缀下是否已有对象 */
    } else {
      throw err instanceof Error ? err : new Error('OSS 操作失败');
    }
  }
  const res = await client.list(
    {
      prefix: dirPrefix,
      'max-keys': 1,
    },
    {},
  );
  if ((res.objects?.length ?? 0) > 0 || (res.prefixes?.length ?? 0) > 0) {
    throw new Error('目标路径已存在文件夹或对象');
  }
}

/**
 * 重命名文件或目录(OSS 无 rename API,等价于 CopyObject + Delete)
 *
 * **文件**
 * - 在同级目录下更换「最后一段」名称:新 Key = 父前缀 + 清洗后的新名称。
 * - 先 head 目标 Key 防覆盖,再 `copy(目标, 源)`,最后 `delete(源)`。
 *
 * **目录**
 * - 用 `list({ prefix: 旧目录/, delimiter 不设 })` 分页收集其下全部对象 Key(含目录占位对象本身)。
 * - 将每个 Key 映射为 `新目录前缀 + 相对旧前缀的后缀`,逐个服务端复制。
 * - 全部复制成功后,按批 `deleteMulti` 删除旧 Key(每批最多 1000 条,与删除目录逻辑一致)。
 * - 若列举结果为空(极少见),则在新前缀写入 0 字节目录占位对象,并尝试删除旧前缀占位(不存在则忽略),与 `createDirectory` 行为对齐。
 * - 目录下对象较多时按批并发 `copy`(每批条数有上限),并通过 `onDirectoryProgress` 上报复制/删除进度。
 *
 * **限制与风险**
 * - 非原子:复制与删除之间若失败,可能残留部分新 Key 或旧 Key,需人工对照控制台清理。
 * - 禁止将目录重命名到自身子路径下(例如 `a/` → `a/b/`),否则逻辑与存储结构不成立。
 * - 浏览器端需 CORS 与权限支持 Copy(通常表现为对目标 Key 的 PUT);错误会经 `normalizeOSSBrowserError` 归一化。
 *
 * @param client OSS 客户端
 * @param entry 被重命名的列表条目(含完整 path 与 type)
 * @param newName 用户输入的新名称(仅最后一段,不含 `/`)
 * @param onDirectoryProgress 仅目录重命名时回调:复制与 deleteMulti 各阶段进度
 * @returns `newPath` 重命名后的完整对象路径;目录结果恒以 `/` 结尾
 * @throws 名称未变、目标已存在、非法名称、OSS 或网络错误
 */
const RENAME_COPY_CONCURRENCY = 8;

export async function renameEntry(
  client: OSS,
  entry: FileEntry,
  newName: string,
  onDirectoryProgress?: (p: RenameDirectoryProgress) => void,
): Promise<{ newPath: string }> {
  const base = sanitizeEntryBaseName(newName);
  if (base === entry.name) {
    throw new Error('名称未改变');
  }

  const parent = parentPrefixFromEntry(entry);

  try {
    if (entry.type === 'file') {
      const destKey = `${parent}${base}`;
      if (destKey === entry.path) {
        throw new Error('名称未改变');
      }
      await assertFileDestinationFree(client, destKey);
      // ali-oss: copy(目标名, 源名), 同桶服务端复制
      await client.copy(destKey, entry.path);
      await client.delete(entry.path);
      return { newPath: destKey };
    }

    // 目录统一成「以 / 结尾」的前缀,便于列举其下所有对象
    const oldPrefix = entry.path.endsWith('/') ? entry.path : `${entry.path}/`;
    const destPrefix = `${parent}${base}/`;

    if (destPrefix === oldPrefix) {
      throw new Error('名称未改变');
    }
    if (destPrefix.startsWith(oldPrefix)) {
      throw new Error('不能将文件夹重命名到自身路径下');
    }

    await assertDirectoryDestinationFree(client, destPrefix);

    // 收集旧前缀下全部对象(不使用 delimiter,才能包含深层文件)
    const keys: string[] = [];
    let marker: string | undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await client.list(
        {
          prefix: oldPrefix,
          'max-keys': 1000,
          marker,
        },
        {},
      );
      for (const obj of res.objects ?? []) {
        keys.push(obj.name);
      }
      if (!res.isTruncated) break;
      marker = res.nextMarker;
    }

    // 空目录:无列举结果则写新占位,并尽量删掉旧前缀占位(与列表占位约定一致,带尾斜杠)
    if (keys.length === 0) {
      onDirectoryProgress?.({ phase: 'copy', done: 0, total: 1 });
      await client.put(destPrefix, new Blob([], { type: 'application/x-directory' }));
      onDirectoryProgress?.({ phase: 'copy', done: 1, total: 1 });
      await deleteObjectIgnoreNotFound(client, oldPrefix);
      return { newPath: destPrefix };
    }

    const pairs = keys.map((key) => {
      const suffix = key.startsWith(oldPrefix) ? key.slice(oldPrefix.length) : key;
      return { src: key, dest: `${destPrefix}${suffix}` };
    });
    const total = pairs.length;
    onDirectoryProgress?.({ phase: 'copy', done: 0, total });
    for (let i = 0; i < pairs.length; i += RENAME_COPY_CONCURRENCY) {
      const batch = pairs.slice(i, i + RENAME_COPY_CONCURRENCY);
      await Promise.all(batch.map(({ src, dest }) => client.copy(dest, src)));
      onDirectoryProgress?.({ phase: 'copy', done: Math.min(i + batch.length, total), total });
    }

    // 源 Key 已全部复制后再删,避免先删导致数据不可恢复
    onDirectoryProgress?.({ phase: 'delete', done: 0, total: keys.length });
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      await client.deleteMulti(chunk, { quiet: true });
      onDirectoryProgress?.({ phase: 'delete', done: Math.min(i + chunk.length, keys.length), total: keys.length });
    }

    return { newPath: destPrefix };
  } catch (err) {
    throw normalizeOSSBrowserError(err);
  }
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
