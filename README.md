# Ali OSS Web Explorer

基于 React + Vite 的阿里云 OSS 文件浏览器，纯前端实现，无需后端服务。通过浏览器直接连接 OSS Bucket，进行文件浏览、上传、下载和管理操作。

## 功能特性

- **连接管理** — 配置 AccessKey、Bucket、Region，凭据保存到 localStorage，刷新不丢失
- **目录浏览** — 面包屑导航，支持多级目录切换，URL 同步目录位置（刷新/前进后退均可恢复）
- **文件上传** — 多文件并发上传（最大 10 个并发），小文件走简单上传，大文件（≥5MB）自动切换分片上传并显示进度
- **文件下载/预览** — 点击文件直接预览（图片、视频、音频、PDF、代码等），不可预览的文件自动触发下载
- **生成签名链接** — 自定义过期时间（1 分钟 ~ 7 天），一键复制分享
- **目录操作** — 新建文件夹、删除目录（递归清空）、批量选择删除
- **文件类型图标** — 根据扩展名自动匹配图标（图片、视频、音频、文档、压缩包、代码等 11 种类型）

## 技术栈

| 技术 | 用途 |
|---|---|
| React 18 + TypeScript | 前端框架 |
| Vite 5 | 构建工具 |
| Ant Design 5 | UI 组件库 |
| Tailwind CSS 3 | 样式工具 |
| ali-oss 6 | 阿里云 OSS SDK |
| dayjs | 日期格式化 |

## 项目结构

```
src/
├── components/          # UI 组件
│   ├── ConfigDrawer.tsx      # OSS 连接配置抽屉
│   ├── FileTable.tsx         # 文件列表表格
│   ├── Toolbar.tsx           # 顶部工具栏
│   ├── Breadcrumbs.tsx       # 面包屑导航
│   ├── UploadDrawer.tsx      # 上传任务面板
│   ├── CreateFolderModal.tsx # 新建文件夹弹窗
│   ├── GenerateUrlModal.tsx  # 生成签名链接弹窗
│   └── fileIcon.ts           # 文件类型图标映射
├── hooks/               # 自定义 Hooks
│   ├── useOSSConfig.ts       # 配置读写与持久化
│   ├── useOSSClient.ts       # 客户端创建与连接验证
│   ├── useOSSFiles.ts        # 文件列表、导航、CRUD
│   └── useUploadTasks.ts     # 上传队列与并发控制
├── services/
│   └── oss.ts                 # ali-oss SDK 封装
├── types/
│   └── oss.ts                 # TypeScript 类型定义
├── utils/
│   ├── storage.ts             # localStorage 工具
│   └── format.ts              # 格式化工具（大小、日期、路径）
└── constants/
    └── regions.ts             # 阿里云 OSS 地域列表
```

## 快速开始

```bash
# 安装依赖
yarn install

# 启动开发服务器（默认 5173 端口，自动打开浏览器）
yarn dev

# 构建生产版本
yarn build
```

## 使用说明

1. 启动后点击右上角「连接配置」
2. 填写 AccessKey ID、AccessKey Secret、Bucket 名称，选择 Region
3. 点击「连接」即可浏览和管理文件

## 注意事项

- **安全性**：AccessKey 明文存储在浏览器 localStorage 中，生产环境建议使用 STS 临时令牌
- **CORS 配置**：大文件分片上传需要在 Bucket CORS 设置中添加 `Expose-Headers: ETag`
- **跨域**：应用纯前端运行，需确保 Bucket 的 CORS 策略允许当前域名访问

## License

MIT
