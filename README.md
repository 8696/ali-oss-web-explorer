# Ali OSS Web Explorer

基于 **React 18 + TypeScript + Vite** 的阿里云 OSS 浏览器端文件管理工具。应用完全在浏览器内运行，通过 [ali-oss](https://github.com/ali-sdk/ali-oss) 直连 Bucket，无需自建后端。

适合个人 / 内网运维场景：配置 AccessKey 后即可浏览、上传、预览、编辑文本、复制剪切、删除（含回收站备份）等。

## 功能特性

### 连接与配置

- 配置 AccessKey ID / Secret、Bucket、Region（下拉可搜索）
- 配置持久化到 `localStorage`，刷新可恢复；支持断开并清空凭据
- 连接时通过列举对象校验权限与网络

> `OSSConfig` 预留了自定义 `endpoint`、`stsToken` 等字段，当前表单以常用直连字段为主。

### 目录与列表

- 面包屑导航，展示当前目录下文件夹数 / 文件数
- 当前目录与地址栏 `?dir=` 同步：进入子目录会 `pushState`，刷新列表用 `replaceState`
- 桶根系统目录 **`回收站/`** 固定排在列表末尾
- 文件表使用 Ant Design Table **虚拟滚动**，适配长列表
- 移动端（`< 768px`）工具栏、表格与弹窗会收缩为图标 / 紧凑布局

### 上传

- 多文件队列，同一时刻最多 **10** 个并行上传
- **&lt; 5 MB** 简单上传；**≥ 5 MB** 分片上传（约 1 MB / 片），抽屉展示进度
- 整批结束后统一提示成功 / 失败统计，有成功则刷新当前目录

### 预览、下载与分享

- **点击文件名**：新开标签页打开短期签名 URL（浏览器可预览则预览，否则下载）
- **下载**：签名 URL 带下载倾向（与仅预览区分）
- **生成链接**：自定义过期时间的签名访问 URL，便于复制分享

### 在线编辑文本

- 常见文本 / 代码扩展名可在浏览器内编辑（上限 **10 MB**）
- 打开时拉取对象内容（自动识别 UTF-8 / GBK），保存时覆盖写回

### 复制、剪切与粘贴

- 内存剪贴板（不落盘）：多选批量复制 / 剪切，或行内单条操作
- **粘贴**目标始终为当前浏览目录；剪切在 OSS 侧为「复制 + 删源」（移动）
- 大目录由进度弹窗展示复制 / 删源阶段；含桶根「回收站」时禁用批量复制 / 剪切

### 目录与对象管理

- 新建文件夹、重命名（目录为前缀树复制再删旧前缀，非原子，有二次确认与进度）
- 对象 ACL：`default` / `private` / `public-read` / `public-read-write`

### 删除与回收站

- 非 `回收站/` 下删除：先备份到 `回收站/{时间戳}/` 对应路径，再删原对象
- 已在 `回收站/` 下：直接删除，不再二次备份
- 多选批量删除需输入确认文案 **「确定删除」**；选中桶根「回收站」时禁用批量删除

## 技术栈

| 技术 | 用途 |
|------|------|
| React 18 + TypeScript | UI 与类型安全 |
| Vite 5 | 开发与构建 |
| Ant Design 5 | 组件与图标 |
| Tailwind CSS 3 | 布局与主题样式 |
| ali-oss 6 | OSS SDK |
| dayjs | 时间展示 |

## 架构概览

采用「**根组件接线 + Hooks 状态 + Service 封装 SDK**」分层：

| 层级 | 职责 |
|------|------|
| `App.tsx` | 组合各 Hook，连接子组件与弹窗；处理剪贴板、粘贴进度、跨模块交互 |
| `hooks/` | 配置持久化、客户端连接、目录列表（含 URL 同步）、粘贴、上传队列、移动端断点 |
| `services/oss.ts` | 唯一直接调用 `ali-oss` 的模块；错误信息中文归一化（含 CORS / ETag 等） |
| `components/` | 工具栏、表格、面包屑、各类 Modal / Drawer |
| `constants/` / `types/` / `utils/` | 地域与回收站约定、领域类型、格式化与本地存储 |

数据流：填写配置 → `useOSSConfig` 落盘 → `useOSSClient` 建连探测 → `useOSSFiles` 按 `prefix` 拉列表；复制 / 剪切只写内存剪贴板，真实 OSS 操作在「粘贴到当前目录」时执行。

## 项目结构

```
.
├── vite.config.ts          # @/ → src、生产 base `/m/`、ali-oss shim、拆包
├── package.json
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── App.tsx             # 根组件接线
    ├── main.tsx
    ├── index.css
    ├── components/
    │   ├── Breadcrumbs.tsx
    │   ├── ConfigModal.tsx
    │   ├── CreateFolderModal.tsx
    │   ├── DeleteConfirmModal.tsx
    │   ├── FileTable.tsx
    │   ├── GenerateUrlModal.tsx
    │   ├── ObjectAclModal.tsx
    │   ├── PasteProgressModal.tsx
    │   ├── RenameModal.tsx
    │   ├── TextEditorModal.tsx
    │   ├── Toolbar.tsx
    │   ├── UploadDrawer.tsx
    │   └── fileIcon.ts
    ├── hooks/
    │   ├── useOSSConfig.ts
    │   ├── useOSSClient.ts
    │   ├── useOSSFiles.ts
    │   ├── useUploadTasks.ts
    │   └── useIsMobile.ts
    ├── services/
    │   └── oss.ts
    ├── constants/
    │   ├── regions.ts
    │   └── recycleBin.ts
    ├── types/
    │   └── oss.ts
    └── utils/
        ├── storage.ts
        └── format.ts
```

## 快速开始

```bash
yarn install
yarn dev          # http://localhost:5173 ，开发环境 base 为 /
yarn build        # tsc -b && vite build；产物 base 为 /m/
yarn preview      # 预览生产构建（按 /m/ 前缀访问）
yarn lint         # tsc -b --noEmit
```

### 构建与部署

- 生产构建在 `vite.config.ts` 中将 **`base` 设为 `/m/`**，便于部署在子路径（如 `https://example.com/m/`）。本地 `yarn dev` 仍为 `/`。
- 若部署在域名根路径，将 `base` 改为 `'/'` 后重新构建。

## 使用说明

1. 启动后打开 **连接配置**，填写 AccessKey、Bucket、Region 并连接。
2. 连接成功后即可浏览、上传、下载、重命名、管理 ACL；文本类文件可在行内菜单选择 **编辑**。
3. 需要批量操作时打开 **多选**，使用批量复制 / 剪切 / 删除（删除需输入「确定删除」）。
4. **复制 / 剪切** 后进入目标文件夹，点击 **粘贴** 完成复制或移动。

## 注意事项

- **安全**：AccessKey 以明文保存在浏览器本地存储，仅适合个人或内网工具。生产环境建议使用 **STS 临时凭证** 并由可信后端签发。
- **CORS**：Bucket 须允许当前站点来源；大文件分片上传需在 CORS **Expose-Headers** 中包含 **ETag**，否则无法完成分片合并（应用会给出中文提示）。
- **回收站**：仅桶根下名为 **`回收站`** 的目录为系统回收站；子路径下同名文件夹按普通目录处理。
- **非原子操作**：目录重命名、剪切移动依赖多次 copy / delete，中途失败可能在新旧路径残留对象，重要数据请先备份。

## License

MIT
