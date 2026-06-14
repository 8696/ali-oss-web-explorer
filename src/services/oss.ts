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
import {
  RECYCLE_BIN_FOLDER,
  ROOT_RECYCLE_BIN_PREFIX,
  isObjectKeyUnderRecycleBin,
  isRecycleBinDirectoryEntry,
} from '@/constants/recycleBin';
import type {
  OSSConfig,
  FileEntry,
  FileClipboardOperation,
  ListFilesResult,
  ObjectAcl,
  PasteProgress,
  RenameDirectoryProgress,
} from '@/types/oss';
import { extractName, MAX_EDITABLE_TEXT_SIZE } from '@/utils/format';

/** 自 `constants/recycleBin` 再导出,便于外部仅从 `services/oss` 引用 OSS 与回收站约定 */
export {
  RECYCLE_BIN_FOLDER,
  ROOT_RECYCLE_BIN_PREFIX,
  isObjectKeyUnderRecycleBin,
  isRecycleBinDirectoryEntry,
  normalizeDirectoryPrefix,
} from '@/constants/recycleBin';

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

/** ali-oss 类型声明未覆盖 getACL/putACL,此处做最小能力断言 */
type OSSAclCapable = OSS & {
  getACL(name: string, options?: Record<string, unknown>): Promise<{ acl?: string }>;
  putACL(name: string, acl: string, options?: Record<string, unknown>): Promise<unknown>;
};

function ossWithAcl(client: OSS): OSSAclCapable {
  return client as OSSAclCapable;
}

const OBJECT_ACL_VALUES: readonly ObjectAcl[] = ['default', 'private', 'public-read', 'public-read-write'];

function parseObjectAcl(raw: string | undefined): ObjectAcl {
  const v = (raw ?? '').trim().toLowerCase();
  return OBJECT_ACL_VALUES.includes(v as ObjectAcl) ? (v as ObjectAcl) : 'private';
}

/**
 * 读取对象的 ACL 设置
 *
 * @param client     OSS 客户端
 * @param objectKey  对象完整路径(Key)
 */
export async function getObjectAcl(client: OSS, objectKey: string): Promise<ObjectAcl> {
  try {
    const { acl } = await ossWithAcl(client).getACL(objectKey);
    return parseObjectAcl(acl);
  } catch (err) {
    throw normalizeOSSBrowserError(err);
  }
}

/**
 * 写入对象的 ACL(读写可见性由 RAM / Bucket Policy 与对象 ACL 共同决定)
 *
 * @param client     OSS 客户端
 * @param objectKey  对象完整路径(Key)
 * @param acl        目标 ACL
 */
export async function putObjectAcl(client: OSS, objectKey: string, acl: ObjectAcl): Promise<void> {
  try {
    await ossWithAcl(client).putACL(objectKey, acl);
  } catch (err) {
    throw normalizeOSSBrowserError(err);
  }
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

/** 根据扩展名推断文本类对象的 Content-Type */
function guessTextMimeType(objectKey: string): string {
  const ext = objectKey.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
  };
  return mimeMap[ext] ?? 'text/plain; charset=utf-8';
}

/**
 * 对字节数组进行简单编码探测
 * 优先检测 UTF-8 BOM，其次验证字节序列是否合法 UTF-8，
 * 不合法则回退为 GBK（兼容国内常见的 GB2312/GBK 编码文本）。
 */
function detectEncoding(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  // UTF-8 BOM: EF BB BF
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return 'utf-8';
  }

  // 验证前 4 KB 是否为合法 UTF-8 序列
  const sampleLen = Math.min(bytes.length, 4096);
  let i = 0;
  while (i < sampleLen) {
    const b = bytes[i];
    let continuationCount = 0;
    if (b <= 0x7F) {
      i++;
      continue;
    } else if ((b & 0xE0) === 0xC0) {
      continuationCount = 1;
    } else if ((b & 0xF0) === 0xE0) {
      continuationCount = 2;
    } else if ((b & 0xF8) === 0xF0) {
      continuationCount = 3;
    } else {
      return 'gbk';
    }
    for (let j = 1; j <= continuationCount; j++) {
      if (i + j >= sampleLen || (bytes[i + j] & 0xC0) !== 0x80) {
        return 'gbk';
      }
    }
    i += 1 + continuationCount;
  }
  return 'utf-8';
}

/**
 * 读取对象文本内容(用于在线编辑)
 * 自动检测编码：优先 UTF-8，否则回退 GBK，兼容国内常见的非 UTF-8 文本文件。
 *
 * @throws 文件过大或读取失败时抛出 Error
 */
export async function getObjectContent(client: OSS, objectKey: string): Promise<string> {
  try {
    const result = await (client as OSS & {
      get(key: string, options: Record<string, unknown>): Promise<{ content: ArrayBuffer }>;
    }).get(objectKey, { responseType: 'arraybuffer' });
    const buffer = result.content as ArrayBuffer;

    if (buffer.byteLength > MAX_EDITABLE_TEXT_SIZE) {
      throw new Error(`文件超过 ${MAX_EDITABLE_TEXT_SIZE / 1024 / 1024} MB，无法在线编辑`);
    }

    const encoding = detectEncoding(buffer);
    return new TextDecoder(encoding).decode(buffer);
  } catch (err) {
    throw normalizeOSSBrowserError(err);
  }
}

/**
 * 将文本内容写回 OSS 对象(覆盖原文件)
 */
export async function putObjectContent(
  client: OSS,
  objectKey: string,
  content: string,
): Promise<void> {
  try {
    await client.put(objectKey, new Blob([content], { type: guessTextMimeType(objectKey) }));
  } catch (err) {
    throw normalizeOSSBrowserError(err);
  }
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

/**
 * 生成本次删除会话在回收站下的目录前缀,形如 `回收站/20260111153045123/`
 * 为本地时间 `YYYYMMDDHHmmss` 后接 3 位毫秒(共 19 位数字),无额外随机段。
 */
function buildRecycleSessionPrefix(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, '0')}`;
  return `${RECYCLE_BIN_FOLDER}/${stamp}/`;
}

/**
 * 分页列举某前缀下的全部对象 Key(prefix 须以 `/` 结尾以表示目录树)
 */
async function listAllObjectKeysWithPrefix(client: OSS, prefixWithSlash: string): Promise<string[]> {
  const keys: string[] = [];
  let marker: string | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await client.list(
      {
        prefix: prefixWithSlash,
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
  return keys;
}

/**
 * 以固定并发度分批执行同桶 `copy(目标, 源)`,避免浏览器侧同时挂起过多请求
 *
 * @param onProgress 每批完成后回调 `(已完成条数, 总条数)`;用于删除前备份进度展示
 */
async function copyObjectPairsConcurrent(
  client: OSS,
  pairs: { src: string; dest: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = pairs.length;
  for (let i = 0; i < pairs.length; i += RENAME_COPY_CONCURRENCY) {
    const batch = pairs.slice(i, i + RENAME_COPY_CONCURRENCY);
    await Promise.all(batch.map(({ src, dest }) => client.copy(dest, src)));
    onProgress?.(Math.min(i + batch.length, total), total);
  }
}

/**
 * 将某目录前缀下的整棵对象树备份到回收站会话目录下
 *
 * 目标 Key 规则: `sessionRoot` + **源对象的完整 Key**(含原前缀),从而在回收站内还原原路径层级。
 * 若列举结果为空但 `head(oldPrefix)` 存在,视为仅有目录占位对象(0 字节),单独 copy 该 Key。
 */
async function copyDirectoryTreeIntoRecycleSession(
  client: OSS,
  directoryPath: string,
  sessionRoot: string,
  onBackupCopyProgress?: (done: number, total: number) => void,
): Promise<void> {
  const oldPrefix = directoryPath.endsWith('/') ? directoryPath : `${directoryPath}/`;
  const keys = await listAllObjectKeysWithPrefix(client, oldPrefix);

  if (keys.length === 0) {
    try {
      await client.head(oldPrefix);
    } catch (err: unknown) {
      const e = err as { status?: number; code?: string };
      if (e?.status === 404 || e?.code === 'NoSuchKey') {
        return;
      }
      throw err instanceof Error ? err : new Error('OSS 操作失败');
    }
    // 空目录树:仅备份「目录占位」这一条,与 createDirectory 写入的 0 字节对象一致
    onBackupCopyProgress?.(0, 1);
    await client.copy(`${sessionRoot}${oldPrefix}`, oldPrefix);
    onBackupCopyProgress?.(1, 1);
    return;
  }

  const pairs = keys.map((key) => ({ src: key, dest: `${sessionRoot}${key}` }));
  onBackupCopyProgress?.(0, pairs.length);
  await copyObjectPairsConcurrent(client, pairs, onBackupCopyProgress);
}

/**
 * 将单个文件复制到回收站会话目录下
 *
 * 目标 Key = `sessionRoot` + `fileKey`,与目录树备份规则一致,便于在回收站中按原路径浏览。
 */
async function copyFileIntoRecycleSession(client: OSS, fileKey: string, sessionRoot: string): Promise<void> {
  await client.copy(`${sessionRoot}${fileKey}`, fileKey);
}

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

  if (isRecycleBinDirectoryEntry(entry)) {
    throw new Error(`「${RECYCLE_BIN_FOLDER}」为桶根系统目录，无法重命名`);
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
 * 将「列表所在目录」前缀规范为粘贴目标父前缀：根目录 `''`，非根一律以 `/` 结尾，
 * 以便与 `parent + entry.name` 拼接成合法 OSS Key。
 */
function normalizeDestParentPrefix(prefix: string): string {
  if (!prefix) return '';
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

/**
 * 将整棵目录对象树复制到另一前缀下（不删除源），用于复制/粘贴与剪切的首阶段。
 *
 * 空目录边界：`listAllObjectKeysWithPrefix` 可能返回空列表，此时尝试 head/copy 目录占位对象，
 * 若源仅为PutObject创建的「零字节目录」占位且无子对象，则退化为创建目标占位。
 */
async function duplicateDirectoryTree(
  client: OSS,
  oldPrefixInput: string,
  destPrefixInput: string,
  onDirectoryProgress?: (p: RenameDirectoryProgress) => void,
): Promise<void> {
  const oldPrefix = oldPrefixInput.endsWith('/') ? oldPrefixInput : `${oldPrefixInput}/`;
  const destPrefix = destPrefixInput.endsWith('/') ? destPrefixInput : `${destPrefixInput}/`;

  await assertDirectoryDestinationFree(client, destPrefix);

  const keys = await listAllObjectKeysWithPrefix(client, oldPrefix);

  if (keys.length === 0) {
    onDirectoryProgress?.({ phase: 'copy', done: 0, total: 1 });
    try {
      await client.head(oldPrefix);
      await client.copy(destPrefix, oldPrefix);
    } catch (err: unknown) {
      const e = err as { status?: number; code?: string };
      if (e?.status === 404 || e?.code === 'NoSuchKey') {
        await client.put(destPrefix, new Blob([], { type: 'application/x-directory' }));
      } else {
        throw err instanceof Error ? err : new Error('OSS 操作失败');
      }
    }
    onDirectoryProgress?.({ phase: 'copy', done: 1, total: 1 });
    return;
  }

  const pairs = keys.map((key) => {
    const suffix = key.startsWith(oldPrefix) ? key.slice(oldPrefix.length) : key;
    return { src: key, dest: `${destPrefix}${suffix}` };
  });
  const total = pairs.length;
  onDirectoryProgress?.({ phase: 'copy', done: 0, total });
  await copyObjectPairsConcurrent(client, pairs, (done, tot) => {
    onDirectoryProgress?.({ phase: 'copy', done, total: tot });
  });
}

/**
 * 将列表中的文件/目录粘贴到目标父前缀下(复制或剪切)。
 *
 * - 目标父前缀与列表列举前缀一致:根目录为 `''`,否则以 `/` 结尾。
 * - 剪切目录后若当前浏览路径落在该目录树下,调用方需根据返回的 `directoryMoves` 改写 prefix。
 *
 * @returns `directoryMoves` 仅含本次剪切成功的目录 (旧前缀 → 新前缀),供导航同步。
 */
export async function pasteEntries(
  client: OSS,
  sources: FileEntry[],
  operation: FileClipboardOperation,
  destParentPrefix: string,
  onPasteProgress?: (p: PasteProgress) => void,
): Promise<{ directoryMoves: { oldPrefix: string; newPrefix: string }[] }> {
  /* 同一 path 只处理一次，避免 UI 多选重复行导致重复复制 */
  const deduped = Array.from(new Map(sources.map((e) => [e.path, e])).values());
  const entryTotal = deduped.length;

  const emit = (partial: Omit<PasteProgress, 'operation'>) => {
    onPasteProgress?.({ operation, ...partial });
  };

  for (const entry of deduped) {
    if (isRecycleBinDirectoryEntry(entry)) {
      throw new Error(`无法复制或移动桶根系统目录「${RECYCLE_BIN_FOLDER}」`);
    }
  }

  const parent = normalizeDestParentPrefix(destParentPrefix);
  const directoryMoves: { oldPrefix: string; newPrefix: string }[] = [];

  /* 剪切目录时禁止迁入自身子路径（OSS 前缀包含关系），否则复制阶段会产生不一致树 */
  if (operation === 'cut') {
    for (const entry of deduped) {
      if (entry.type === 'directory') {
        const oldPrefix = entry.path.endsWith('/') ? entry.path : `${entry.path}/`;
        const destDirPrefix = `${parent}${entry.name}/`;
        if (destDirPrefix.startsWith(oldPrefix)) {
          throw new Error('不能将文件夹移动到自身路径下');
        }
      }
    }
  }

  try {
    for (let idx = 0; idx < deduped.length; idx++) {
      const entry = deduped[idx];
      const entryIndex = idx + 1;

      /* ----- 文件：单对象 copy，剪切时再 delete 源 ----- */
      if (entry.type === 'file') {
        const destKey = `${parent}${entry.name}`;
        if (operation === 'cut' && destKey === entry.path) {
          throw new Error('目标与源相同');
        }
        emit({
          entryIndex,
          entryTotal,
          entryName: entry.name,
          entryType: 'file',
          phase: 'copy',
          done: 0,
          total: 1,
        });
        await assertFileDestinationFree(client, destKey);
        await client.copy(destKey, entry.path);
        emit({
          entryIndex,
          entryTotal,
          entryName: entry.name,
          entryType: 'file',
          phase: 'copy',
          done: 1,
          total: 1,
        });
        if (operation === 'cut') {
          emit({
            entryIndex,
            entryTotal,
            entryName: entry.name,
            entryType: 'file',
            phase: 'delete',
            done: 0,
            total: 1,
          });
          await deleteObjectIgnoreNotFound(client, entry.path);
          emit({
            entryIndex,
            entryTotal,
            entryName: entry.name,
            entryType: 'file',
            phase: 'delete',
            done: 1,
            total: 1,
          });
        }
      } else {
        /* ----- 目录：duplicateDirectoryTree 整树复制；剪切时再 deleteDirectory 删源并记录映射 ----- */
        const oldPrefix = entry.path.endsWith('/') ? entry.path : `${entry.path}/`;
        const destDirPrefix = `${parent}${entry.name}/`;
        if (operation === 'cut' && destDirPrefix === oldPrefix) {
          throw new Error('目标与源相同');
        }
        const wrapDir = (p: RenameDirectoryProgress) => {
          emit({
            entryIndex,
            entryTotal,
            entryName: entry.name,
            entryType: 'directory',
            phase: p.phase,
            done: p.done,
            total: p.total,
          });
        };
        await duplicateDirectoryTree(client, oldPrefix, destDirPrefix, wrapDir);
        if (operation === 'cut') {
          await deleteDirectory(client, oldPrefix, (p) => {
            emit({
              entryIndex,
              entryTotal,
              entryName: entry.name,
              entryType: 'directory',
              phase: 'delete',
              done: p.done,
              total: p.total,
            });
          });
          directoryMoves.push({ oldPrefix, newPrefix: destDirPrefix });
        }
      }
    }
    return { directoryMoves };
  } catch (err) {
    const e = normalizeOSSBrowserError(err);
    const m = e.message;
    const hint = '复制或移动为多步操作，失败时可能已部分完成，请刷新列表并核对源路径与目标路径。';
    if (
      /已部分完成|请刷新列表|核对源路径与目标路径/.test(m) ||
      /CORS|Expose-Headers|跨域设置/.test(m)
    ) {
      throw e;
    }
    throw new Error(`${m}（${hint}）`);
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
 *
 * 删除前将「回收站」目录以外的对象完整备份到 `回收站/{YYYYMMDDHHmmss + 三位毫秒}/{原对象完整路径}`(同桶 copy);
 * 已在 `回收站/` 下的对象不再次备份,直接删除。全部备份(若有)成功后再按目录递归删除、再批量删除文件 Key。
 *
 * 执行顺序(保证备份完整后再删源):
 * 1. 按路径去重,并拒绝删除桶根系统「回收站」目录本身;
 * 2. 对需备份的**每个选中目录**整树 copy 到同一会话前缀下(懒创建 `sessionRoot`);
 * 3. 对需备份的**每个选中文件**单独 copy,但若该文件路径已落在某个**选中目录**之下则跳过
 *    (避免目录树备份与单文件备份重复写入同一源对象);
 * 4. `deleteDirectory` 递归删各选中目录;`deleteMulti` 分批删选中文件。
 *
 * @param client OSS 客户端
 * @param entries 目标条目列表
 * @param options.onBackupCopyProgress 可选,备份 copy 进度(已完成条数/总条数)
 * @returns `backedUp` 为 true 表示本次至少执行过一次回收站备份复制
 */
export async function deleteEntries(
  client: OSS,
  entries: FileEntry[],
  options?: { onBackupCopyProgress?: (done: number, total: number) => void },
): Promise<{ backedUp: boolean }> {
  const onBackupCopyProgress = options?.onBackupCopyProgress;
  try {
    // 同一 path 只处理一次(例如表格与逻辑层重复传入)
    const dedupedEntries = Array.from(new Map(entries.map((entry) => [entry.path, entry])).values());
    if (dedupedEntries.some((entry) => isRecycleBinDirectoryEntry(entry))) {
      throw new Error(
        `禁止删除桶根系统目录「${RECYCLE_BIN_FOLDER}」。请进入该目录后管理或删除其中的备份会话子文件夹。`,
      );
    }
    const directoryPaths = dedupedEntries
      .filter((entry) => entry.type === 'directory')
      .map((entry) => entry.path);
    const fileKeys = dedupedEntries
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.path);

    const directoryPrefixes = directoryPaths.map((p) => (p.endsWith('/') ? p : `${p}/`));
    /** 本批删除共用的回收站子前缀;仅当存在至少一次「需备份」的 copy 时才创建 */
    let sessionRoot: string | null = null;
    let backedUp = false;

    const ensureSessionRoot = (): string => {
      if (!sessionRoot) {
        sessionRoot = buildRecycleSessionPrefix();
      }
      return sessionRoot;
    };

    // 阶段 A: 备份选中目录(回收站内的目录树不再向回收站二次备份)
    for (const directoryPath of directoryPaths) {
      const dirPrefix = directoryPath.endsWith('/') ? directoryPath : `${directoryPath}/`;
      if (isObjectKeyUnderRecycleBin(dirPrefix)) {
        continue;
      }
      await copyDirectoryTreeIntoRecycleSession(
        client,
        directoryPath,
        ensureSessionRoot(),
        onBackupCopyProgress,
      );
      backedUp = true;
    }

    // 阶段 B: 备份选中文件(跳过已含于选中目录树中的文件,以及已在回收站下的文件)
    for (const fileKey of fileKeys) {
      const underSelectedDir = directoryPrefixes.some((dirPrefix) => fileKey.startsWith(dirPrefix));
      if (underSelectedDir) {
        continue;
      }
      if (isObjectKeyUnderRecycleBin(fileKey)) {
        continue;
      }
      await copyFileIntoRecycleSession(client, fileKey, ensureSessionRoot());
      backedUp = true;
    }

    // 阶段 C/D: 先删目录再删文件;目录内对象已在上一阶段随 deleteDirectory 清空
    for (const directoryPath of directoryPaths) {
      const dirPrefix = directoryPath.endsWith('/') ? directoryPath : `${directoryPath}/`;
      await deleteDirectory(client, dirPrefix);
    }

    for (let index = 0; index < fileKeys.length; index += 1000) {
      const chunk = fileKeys.slice(index, index + 1000);
      if (chunk.length > 0) {
        await client.deleteMulti(chunk, { quiet: true });
      }
    }

    return { backedUp };
  } catch (err) {
    const e = normalizeOSSBrowserError(err);
    const m = e.message;
    const hint = '含回收站备份在内为多步操作，失败时可能已部分完成，请刷新列表核对。';
    // 已带补充说明或 CORS 专用提示的错误,避免重复拼接括号后缀
    if (
      /已部分完成|请刷新列表核对/.test(m) ||
      /CORS|Expose-Headers|跨域设置/.test(m)
    ) {
      throw e;
    }
    throw new Error(`${m}（${hint}）`);
  }
}

/**
 * 递归删除目录下的所有对象
 *
 * 由于 OSS 无目录概念，需要：
 *   1. 用 prefix 列举该目录下所有对象（不使用 delimiter，含「目录」占位与子对象）
 *   2. 先合并完整 Key 列表，再按每批最多 1000 个调用 deleteMulti（便于上报删除进度）
 *
 * @param client OSS 客户端
 * @param prefix 目录前缀，必须以 `/` 结尾
 * @param onProgress 可选；删除大量对象时上报 `done/total`，供剪切目录等 UI 使用
 */
export async function deleteDirectory(
  client: OSS,
  prefix: string,
  onProgress?: (p: RenameDirectoryProgress) => void,
): Promise<void> {
  if (!prefix.endsWith('/')) {
    throw new Error('目录前缀必须以 "/" 结尾');
  }
  if (prefix === ROOT_RECYCLE_BIN_PREFIX) {
    throw new Error(`禁止递归删除桶根系统目录「${RECYCLE_BIN_FOLDER}」。`);
  }

  const keys = await listAllObjectKeysWithPrefix(client, prefix);
  if (keys.length === 0) {
    return;
  }
  const total = keys.length;
  onProgress?.({ phase: 'delete', done: 0, total });
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await client.deleteMulti(chunk, { quiet: true });
    onProgress?.({ phase: 'delete', done: Math.min(i + chunk.length, total), total });
  }
}
