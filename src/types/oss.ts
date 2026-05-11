/**
 * 阿里云 OSS 模块的类型定义
 * 集中定义配置、文件对象、上传任务等领域模型,确保整个项目类型一致
 */

/**
 * OSS 连接配置
 * 这些信息会在用户连接时输入,并(可选)缓存在 localStorage 中
 *
 * 安全提示:在生产环境中直接将 AccessKey 暴露在前端存在安全风险,
 * 推荐使用 STS 临时凭证。该项目作为内部工具/开发辅助使用,因此采用直连方式。
 */
export interface OSSConfig {
  /** 阿里云 AccessKey ID */
  accessKeyId: string;
  /** 阿里云 AccessKey Secret */
  accessKeySecret: string;
  /** OSS Bucket 名称 */
  bucket: string;
  /** Bucket 所在区域,例如:oss-cn-hangzhou */
  region: string;
  /** 是否使用 HTTPS,默认 true */
  secure?: boolean;
  /** 自定义 endpoint(可选),设置后会覆盖 region */
  endpoint?: string;
  /** 安全令牌(可选),使用 STS 时填写 */
  stsToken?: string;
}

/**
 * 文件条目类型
 * - file: 普通文件
 * - directory: 目录(在 OSS 中本质上是 CommonPrefix 或以 / 结尾的对象)
 */
export type FileEntryType = 'file' | 'directory';

/**
 * 文件浏览器中展示的单条记录
 * 同时承载文件和目录两种语义,便于在同一张表格中渲染
 */
export interface FileEntry {
  /** 用作表格 rowKey 的唯一标识 */
  key: string;
  /** 显示名称(去掉前缀后的最后一段) */
  name: string;
  /** OSS 中的完整对象路径(目录以 / 结尾) */
  path: string;
  /** 条目类型:文件或目录 */
  type: FileEntryType;
  /** 文件大小,目录为 0 */
  size: number;
  /** 最后修改时间,目录为 undefined */
  lastModified?: string;
  /** OSS 存储类型(Standard/IA/Archive 等),仅文件有 */
  storageClass?: string;
  /** 文件 ETag(标识文件内容的指纹) */
  etag?: string;
}

/**
 * 文件列表查询结果
 * 列举对象时分页返回,包含目录(CommonPrefixes)和文件(Contents)
 */
export interface ListFilesResult {
  /** 文件与目录的合并列表(目录排在前面) */
  entries: FileEntry[];
  /** 当前列举的前缀(等于当前所在目录) */
  prefix: string;
  /** 是否还有下一页 */
  isTruncated: boolean;
  /** 下一页的 marker,继续翻页时传入 */
  nextMarker?: string;
}

/**
 * 上传任务在 UI 层的状态描述
 * 用于驱动上传进度弹窗的渲染
 */
export interface UploadTask {
  /** 上传任务唯一 ID */
  id: string;
  /** 所属批次 ID,一次 enqueue 调用会生成一个批次 */
  batchId?: string;
  /** 原始文件对象引用 */
  file: File;
  /** 目标对象 Key(完整路径) */
  objectKey: string;
  /** 上传进度,0 ~ 100 */
  progress: number;
  /** 状态机:waiting -> uploading -> success / error */
  status: 'waiting' | 'uploading' | 'success' | 'error';
  /** 错误信息(若有) */
  errorMessage?: string;
  /** ali-oss multipartUpload 返回的 checkpoint,用于断点续传 */
  checkpoint?: unknown;
}

/**
 * 面包屑路径节点
 * 用于从根目录到当前目录拆分出的可点击片段
 */
export interface BreadcrumbItem {
  /** 显示名称("根目录" 或 子目录名) */
  label: string;
  /** 点击后跳转的目录前缀 */
  prefix: string;
}

/**
 * 目录重命名过程中用于 UI 的进度(复制 / 批量删除)
 */
export interface RenameDirectoryProgress {
  phase: 'copy' | 'delete';
  done: number;
  total: number;
}
