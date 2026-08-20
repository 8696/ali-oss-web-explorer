/**
 * 拖拽上传时递归解析文件夹结构
 *
 * 浏览器原生 `DataTransfer.files` 在拖入文件夹时只会得到该文件夹本身的一条记录,
 * 不会展开其内部文件/子文件夹。主流浏览器(Chrome / Edge / Safari / Firefox)均支持
 * 非标准的 `DataTransferItem.webkitGetAsEntry()`,可取得 `FileSystemEntry` 并递归遍历目录树。
 *
 * 若浏览器不支持该 API(极少见的旧版本),`resolveDroppedItems` 会静默降级为只处理顶层文件,
 * 拖入的文件夹会被忽略(不会当作文件上传失败)。
 */

/** 拖拽解析出的单个文件及其相对路径 */
export interface DroppedFileItem {
  /** 原始文件对象 */
  file: File;
  /** 相对于拖拽根的路径(不含目标目录前缀),例如 "photos/a.png"；顶层文件即为文件名本身 */
  relativePath: string;
}

/** 拖拽解析出的空文件夹(遍历时未发现任何文件),用于在 OSS 侧保留目录结构 */
export interface DroppedFolderItem {
  /** 相对于拖拽根的路径,以 "/" 结尾,例如 "photos/empty/" */
  relativePath: string;
}

export interface ResolvedDropPayload {
  files: DroppedFileItem[];
  emptyFolders: DroppedFolderItem[];
}

/**
 * `webkitGetAsEntry` 为非标准 API,TS 内置 lib.dom.d.ts 中 `DataTransferItem` 未声明该方法,
 * 但已声明 `FileSystemEntry` / `FileSystemFileEntry` / `FileSystemDirectoryEntry` 等相关类型,
 * 这里补充方法签名并复用内置类型,避免与 `FileSystemEntry` 产生结构不兼容。
 */
type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

/** `readEntries` 单次最多返回约 100 条,需持续调用直到返回空数组才算读完当前目录 */
async function readAllDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

/** 递归遍历单个 entry(文件直接收集;目录递归展开,空目录记录为占位) */
async function walkEntry(entry: FileSystemEntry, basePath: string, out: ResolvedDropPayload): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
    out.files.push({ file, relativePath: `${basePath}${entry.name}` });
    return;
  }
  if (!entry.isDirectory) return;

  const dirEntry = entry as FileSystemDirectoryEntry;
  const children = await readAllDirectoryEntries(dirEntry.createReader());
  if (children.length === 0) {
    out.emptyFolders.push({ relativePath: `${basePath}${entry.name}/` });
    return;
  }
  await Promise.all(children.map((child) => walkEntry(child, `${basePath}${entry.name}/`, out)));
}

/**
 * 解析拖拽释放时的 `DataTransferItemList`,递归展开其中的文件夹
 *
 * 注意:必须在 `drop` 事件处理函数内**同步**调用 `webkitGetAsEntry()`(浏览器会在事件返回后
 * 清空 `DataTransferItemList`),取得的 `FileSystemEntry` 引用之后才可安全地异步递归遍历。
 *
 * @param items `e.dataTransfer.items`
 */
export async function resolveDroppedItems(items: DataTransferItemList): Promise<ResolvedDropPayload> {
  const out: ResolvedDropPayload = { files: [], emptyFolders: [] };
  const entries: FileSystemEntry[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as DataTransferItemWithEntry;
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      entries.push(entry);
    } else {
      // 不支持 File System Entry API 的浏览器兜底:仅取到普通 File,文件夹会被浏览器忽略或报 undefined
      const file = item.getAsFile();
      if (file) {
        out.files.push({ file, relativePath: file.name });
      }
    }
  }

  await Promise.all(entries.map((entry) => walkEntry(entry, '', out)));
  return out;
}
