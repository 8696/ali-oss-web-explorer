# Ali OSS Web Explorer

基于 **React 18 + TypeScript + Vite** 的阿里云 OSS 浏览器端文件管理工具。应用完全在浏览器内运行，通过 [ali-oss](https://github.com/ali-sdk/ali-oss) 直连 Bucket，无需自建后端。

## 架构概览

采用「**根组件接线 + Hooks 状态 + Service 封装 SDK**」的分层方式，职责边界清晰：

| 层级 | 职责 |
|------|------|
| **`App.tsx`** | 组合 `useOSSConfig` / `useOSSClient` / `useOSSFiles` / `useUploadTasks`，连接各子组件与弹窗；处理跨模块交互（删除后同步多选 key、上传批次结束刷新列表、**内存剪贴板与粘贴进度弹窗**等）。 |
| **`hooks/`** | 配置持久化、客户端创建与连接探测、当前目录与列表（含 URL 同步）、**粘贴（复制/剪切移动）**、上传队列与并发控制。 |
| **`services/oss.ts`** | **唯一**与 `ali-oss` 直接交互的模块：列举、上传、删除/回收站备份、重命名（copy+delete）、**批量粘贴（复制对象树 ± 删源）**、签名 URL、对象 ACL 等；并对浏览器端常见错误（如 CORS 未暴露 ETag）做中文提示归一化。 |
| **`components/`** | 纯 UI 与局部交互：工具栏、表格（含虚拟滚动）、面包屑、各类 Drawer/Modal（含 **`PasteProgressModal` 粘贴进度**）。 |
| **`constants/`** | 与业务约定相关的常量（如地域列表、桶根「回收站」目录规则）。 |
| **`types/`** | 领域模型与 `OSSConfig`、`FileEntry`、剪贴板与粘贴进度等类型，供全项目复用。 |
| **`utils/`** | `localStorage` 读写、路径/大小/日期格式化等无 OSS 依赖的工具。 |

数据流简述：用户填写配置 → `useOSSConfig` 写入本地存储 → `useOSSClient` 创建 client 并 `list` 探测 → `useOSSFiles` 按当前 `prefix` 拉取列表；表格与工具栏的操作经 `App` 回调进入对应 Hook 或 `services/oss`；**复制/剪切仅写入内存态剪贴板，真实 OSS 复制在「粘贴到当前目录」时执行**。

## 功能特性

### 连接与配置

- 在抽屉中配置 **AccessKey ID / Secret**、**Bucket**、**Region**（下拉支持搜索，便于内网或非常用地域）。
- 配置持久化到 **localStorage**，刷新页面可恢复；支持断开连接并清空凭据。
- 连接建立后通过列举对象验证权限与网络。

> `OSSConfig` 类型中还预留了 **自定义 endpoint**、**STS Token** 等字段，便于后续扩展；当前配置表单以常用直连字段为主。

### 目录与列表

- **面包屑**导航，展示当前目录下文件夹数 / 文件数；支持刷新。
- 目录位置与浏览器地址栏 **`?dir=`** 同步：主动进入子目录会 `pushState`，可被后退恢复；列表刷新等场景使用 `replaceState`，避免多余历史栈。
- 桶根下的系统目录 **`回收站/`** 在列表中**固定排在末尾**，与普通业务目录区分。
- 文件表启用 Ant Design Table **`virtual`** 与动态 **`scroll.y`**，长列表滚动更顺畅。

### 上传

- 多文件加入队列，**同一时刻最多 10 个文件并行上传**（避免占满浏览器连接）。
- **小于 5 MB** 走简单上传；**≥ 5 MB** 使用分片上传（默认约 1 MB 分片），上传抽屉中展示进度。
- 当前批次**全部结束**后统一提示成功/失败统计；若有成功则刷新当前目录列表。

### 预览与下载

- **点击文件名**：新开标签页，使用短期签名访问 URL，浏览器可预览的类型（图片、音视频、PDF、部分文本等）直接展示，否则表现为下载。
- 操作列 **下载**：使用带下载倾向的签名 URL（与「仅预览」区分）。

### 分享链接

- 对文件生成 **签名访问 URL**，可自定义过期时间，便于复制分享。

### 复制、剪切与粘贴

- **内存剪贴板**（不落盘）：多选模式下可 **批量复制**、**批量剪切**；操作列「更多」内也可对单行 **复制 / 剪切**（剪切目录前会二次确认）。
- **粘贴**目标始终为**当前浏览目录**；工具栏在剪贴板非空时显示 **粘贴**，经 Popconfirm 确认后执行。
- **剪切**在 OSS 侧为「复制到目标路径 + 删除源路径」，即移动；大目录会耗时较长，由 **`PasteProgressModal`** 展示整体进度（复制阶段 / 删除源阶段），进度回调在 App 内节流以避免界面闪烁。
- 若多选包含桶根系统目录 **「回收站」**，**批量复制 / 批量剪切** 与批量删除规则一致，会被禁用（避免误操作系统虚拟目录）。

### 目录与对象管理

- **新建文件夹**（在当前前缀下创建「目录占位」对象）。
- **重命名**：支持文件与目录；目录重命名在 OSS 侧为复制前缀树再删除旧前缀，界面可展示**进度**（大目录耗时较长）；目录重命名前会二次说明非原子操作风险。
- **对象 ACL**：对文件读取并修改对象级 ACL（`default` / `private` / `public-read` / `public-read-write`）。

### 删除与回收站

- 在**非** `回收站/` 树内的删除：先将对象备份到 **`回收站/{时间戳}/`** 下对应路径，再删除原对象（软删除式备份，便于误删恢复）。
- 已在 **`回收站/`** 前缀下的删除：**不再二次备份**，直接删除。
- **多选模式** + **批量删除**：需经确认弹窗，并要求输入 **「确定删除」** 文案；若选中项包含桶根系统 **「回收站」** 文件夹，批量删除会被禁用（避免误删整个回收站结构）。

## 技术栈

| 技术 | 用途 |
|------|------|
| React 18 + TypeScript | UI 与类型安全 |
| Vite 5 | 开发与构建 |
| Ant Design 5 + `@ant-design/icons` | 组件与图标 |
| Tailwind CSS 3 | 布局与主题化样式（`index.css` 内亦有全局壳层与表格等样式） |
| ali-oss 6 | OSS SDK |
| dayjs | 时间展示 |

## 项目结构

```
.
├── vite.config.ts             # Vite：@/ → src、生产 base `/m/`、ali-oss 浏览器 shim、拆包
├── package.json
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── postcss.config.js          # Tailwind / autoprefixer（若存在）
├── tailwind.config.js         # Tailwind 配置（若存在）
└── src/
    ├── App.tsx                # 根组件：状态接线与子组件组合（含剪贴板、粘贴进度）
    ├── main.tsx
    ├── index.css              # Tailwind 入口 + 全局布局 / 表格 / 弹窗等样式
    ├── vite-env.d.ts
    ├── components/
    │   ├── Breadcrumbs.tsx     # 面包屑与目录统计
    │   ├── ConfigModal.tsx     # OSS 连接配置弹窗
    │   ├── CreateFolderModal.tsx    # 新建文件夹弹窗
    │   ├── DeleteConfirmModal.tsx   # 批量/单行删除二次确认（口令）
    │   ├── FileTable.tsx            # 文件列表、虚拟滚动、行内操作与复制剪切入口
    │   ├── GenerateUrlModal.tsx     # 生成签名链接
    │   ├── ObjectAclModal.tsx       # 对象 ACL
    │   ├── PasteProgressModal.tsx   # 粘贴 / 剪切移动的进度展示
    │   ├── RenameModal.tsx          # 重命名（含目录进度）
    │   ├── Toolbar.tsx              # 上传 / 新建 / 多选 / 复制剪切粘贴 / 批量删除 / 刷新 / 配置
    │   ├── UploadDrawer.tsx         # 上传任务与进度
    │   └── fileIcon.ts              # 扩展名 → 图标映射
    ├── hooks/
    │   ├── useOSSConfig.ts    # 配置读写与 localStorage
    │   ├── useOSSClient.ts    # 客户端与连接校验
    │   ├── useOSSFiles.ts     # 前缀、列表、导航、CRUD、重命名、粘贴、URL 同步
    │   └── useUploadTasks.ts  # 上传队列与并发
    ├── services/
    │   └── oss.ts             # ali-oss 封装与错误归一化
    ├── constants/
    │   ├── regions.ts         # Region 列表
    │   └── recycleBin.ts      # 回收站路径约定与判断函数
    ├── types/
    │   └── oss.ts             # OSSConfig、FileEntry、剪贴板与粘贴进度等类型
    └── utils/
        ├── storage.ts
        └── format.ts
```

## 快速开始

```bash
yarn install
yarn dev          # 默认 http://localhost:5173 ，开发环境站点根路径为 /
yarn build        # tsc -b && vite build；产物静态资源 base 为 /m/
yarn preview      # 预览生产构建（按 /m/ 前缀访问）
yarn lint         # tsc -b --noEmit
```

### 构建与部署说明

- 生产构建在 `vite.config.ts` 中将 **`base` 设为 `/m/`**，便于部署在站点子路径（例如 `https://example.com/m/index.html`）。本地 **`yarn dev`** 仍为根路径 `/`。
- 若需部署在域名根路径，请将 `vite.config.ts` 中 `base` 改为 `'/'` 后重新构建。

## 使用说明

1. 启动后点击工具栏 **连接配置**（或右上角设置入口），填写 AccessKey、Bucket、Region，**连接**。
2. 连接成功后即可浏览、上传、下载、重命名、管理 ACL；需要批量操作时打开 **多选**，选中后使用 **批量删除**（按弹窗提示输入确认文案）。
3. **复制 / 剪切** 后进入目标文件夹，点击 **粘贴** 将对象复制或移动到当前目录。

## 注意事项

- **安全**：AccessKey 以明文形式保存在浏览器本地存储中，仅适合个人或内网工具场景；生产环境强烈建议使用 **STS 临时凭证** 并由可信后端签发，避免长期密钥暴露在前端。
- **CORS**：纯前端访问 OSS 必须在 Bucket 上配置允许当前站点来源的跨域规则；**大文件分片上传**需要在 CORS 的 **Expose-Headers** 中包含 **ETag**，否则浏览器无法完成分片合并（项目内会将此类错误提示为可操作的中文说明）。
- **回收站**：备份目录名为 **`回收站`**，且仅**桶根**下该目录被视为系统回收站；子路径下同名的普通文件夹行为与系统回收站不同。

## License

MIT
