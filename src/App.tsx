/**
 * App
 *
 * 应用根组件,职责:
 *   1. 组装所有 Hooks(Config / Client / Files / Upload);
 *   2. 作为唯一的状态提升层,把各 Hook 的输入输出连接起来;
 *   3. 渲染子组件(Toolbar / Breadcrumbs / FileTable / 各种弹窗);
 *   4. 不包含复杂 UI 逻辑,仅做"接线"工作。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App as AntdApp, Layout, Button, Badge, ConfigProvider, theme } from 'antd';
import {
  CloudServerOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons';
import { useOSSConfig } from '@/hooks/useOSSConfig';
import { useOSSClient } from '@/hooks/useOSSClient';
import { useOSSFiles } from '@/hooks/useOSSFiles';
import { useUploadTasks } from '@/hooks/useUploadTasks';
import { ConfigDrawer } from '@/components/ConfigDrawer';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Toolbar } from '@/components/Toolbar';
import { FileTable } from '@/components/FileTable';
import { UploadDrawer } from '@/components/UploadDrawer';
import { CreateFolderModal } from '@/components/CreateFolderModal';
import { GenerateUrlModal } from '@/components/GenerateUrlModal';
import { getSignedAccessUrl } from '@/services/oss';
import type { FileEntry } from '@/types/oss';

const { Header, Content } = Layout;

/**
 * App 组件
 * 使用 AntdApp 包裹以获得 message/notification 等全局 API
 */
const AppInner: React.FC = () => {
  const { message } = AntdApp.useApp();

  // ====== 状态管理 ======
  const { config, setConfig, clearConfig } = useOSSConfig();
  const { client, connecting, connected, error: connectError } = useOSSClient(config);
  const { prefix, entries, loading, error: listError, navigate, refresh, createFolder, removeEntry, removeEntries } = useOSSFiles(client);

  /**
   * 上传任务:整批任务全部完成后才统一刷新文件列表并统一提示
   */
  const { tasks, uploading, enqueue, clearCompleted } = useUploadTasks(client, {
    onBatchComplete: (result) => {
      // 只有存在成功上传时才刷新列表,避免纯失败批次触发无意义的全量重新拉取
      if (result.successCount > 0) {
        void refresh();
      }

      if (result.errorCount === 0) {
        message.success(`上传完成，共 ${result.successCount} 个文件`);
        return;
      }

      if (result.successCount === 0) {
        message.error(`上传失败，共 ${result.errorCount} 个文件`);
        return;
      }

      message.warning(
        `上传完成：成功 ${result.successCount} 个，失败 ${result.errorCount} 个`,
      );
    },
  });

  // ====== UI 开关状态 ======
  const [configOpen, setConfigOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [generateUrlOpen, setGenerateUrlOpen] = useState(false);
  const [generateUrlEntry, setGenerateUrlEntry] = useState<FileEntry | null>(null);

  /**
   * 当前目录的文件统计
   * 从已加载的 entries 中拆分出文件夹数和文件数,用于在面包屑右侧展示。
   */
  const directoryStats = useMemo(() => {
    const folderCount = entries.filter((entry) => entry.type === 'directory').length;
    const fileCount = entries.filter((entry) => entry.type === 'file').length;
    return { folderCount, fileCount };
  }, [entries]);

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedRowKeys.includes(entry.key)),
    [entries, selectedRowKeys],
  );

  const selectedCount = selectedEntries.length;
  const hasDirectorySelection = useMemo(
    () => selectedEntries.some((entry) => entry.type === 'directory'),
    [selectedEntries],
  );

  // ====== 事件处理 ======

  /**
   * 连接 OSS:保存配置并触发 useOSSClient 重新验证
   */
  const handleConnect = useCallback(
    (newConfig: typeof config) => {
      setConfig(newConfig!);
      // 连接验证由 useOSSClient 的 effect 自动处理
    },
    [setConfig],
  );

  /**
   * 断开连接:清空配置,重置所有状态
   */
  const handleDisconnect = useCallback(() => {
    clearConfig();
    setSelectionMode(false);
    setSelectedRowKeys([]);
    message.info('已断开 OSS 连接');
  }, [clearConfig, message]);

  /**
   * 上传文件:添加到上传队列并打开上传面板
   */
  const handleUpload = useCallback(
    (files: File[]) => {
      enqueue(files, prefix);
      setUploadOpen(true);
    },
    [enqueue, prefix],
  );

  /**
   * 点击文件行:新标签页打开，浏览器能预览的直接展示，不能的自动下载
   */
  const handleDownload = useCallback(
    (entry: FileEntry) => {
      if (!client) return;
      try {
        const url = getSignedAccessUrl(client, entry.path, 600);
        window.open(url, '_blank');
      } catch (err) {
        message.error('操作失败');
        console.error('[handleDownload]', err);
      }
    },
    [client, message],
  );

  /**
   * 删除文件/目录
   */
  const handleDelete = useCallback(
    async (entry: FileEntry) => {
      try {
        await removeEntry(entry);
        setSelectedRowKeys((currentKeys) => currentKeys.filter((key) => key !== entry.key));
        message.success(`已删除 ${entry.name}`);
      } catch (err) {
        message.error(err instanceof Error ? err.message : '删除失败');
      }
    },
    [removeEntry, message],
  );

  const handleBulkDelete = useCallback(async () => {
    if (selectedEntries.length === 0) return;

    try {
      await removeEntries(selectedEntries);
      setSelectedRowKeys([]);
      message.success(`已删除 ${selectedEntries.length} 项`);
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : '批量删除失败，部分对象可能已删除，请刷新后确认',
      );
    }
  }, [removeEntries, selectedEntries, message]);

  const handleToggleSelectionMode = useCallback(() => {
    setSelectionMode((currentMode) => {
      if (currentMode) {
        setSelectedRowKeys([]);
      }
      return !currentMode;
    });
  }, []);

  /**
   * 新建文件夹
   */
  const handleCreateFolder = useCallback(
    async (name: string) => {
      await createFolder(name);
      message.success(`文件夹「${name}」已创建`);
      setCreateFolderOpen(false);
    },
    [createFolder, message],
  );

  /**
   * 生成访问链接
   */
  const handleGenerateUrl = useCallback(
    (entry: FileEntry) => {
      setGenerateUrlEntry(entry);
      setGenerateUrlOpen(true);
    },
    [],
  );

  const handleGenerateUrlAction = useCallback(
    (expiresMinutes: number) => {
      if (!client || !generateUrlEntry) return '';
      return getSignedAccessUrl(client, generateUrlEntry.path, expiresMinutes * 60);
    },
    [client, generateUrlEntry],
  );

  useEffect(() => {
    setSelectedRowKeys([]);
  }, [prefix]);

  useEffect(() => {
    if (!connected) {
      setSelectionMode(false);
      setSelectedRowKeys([]);
    }
  }, [connected]);

  // 连接状态变更的错误提示
  React.useEffect(() => {
    if (connectError) {
      message.error(connectError);
    }
  }, [connectError, message]);

  // 列表加载错误提示
  React.useEffect(() => {
    if (listError) {
      message.error(listError);
    }
  }, [listError, message]);

  return (
    <Layout className="app-shell h-screen bg-canvas">
      <Header
        className="app-shell__header flex items-center justify-between border-b border-line/80 bg-paper/90 backdrop-blur"
      >
        <div className="app-shell__brand flex items-center gap-4 leading-none">
          <div className="app-shell__brand-mark flex items-center justify-center bg-primary/10 text-primary">
            <CloudServerOutlined style={{ fontSize: 20 }} />
          </div>
          <div className="app-shell__brand-copy flex flex-col justify-center gap-1">
            <span className="text-[20px] font-semibold tracking-[0.01em] text-ink">
              OSS 文件管理
            </span>
            {connected && config && (
              <span className="app-shell__meta text-sm text-muted">
                {config.bucket} · {config.region}
              </span>
            )}
          </div>
        </div>

        <div className="app-shell__header-actions flex items-center gap-2">
          {/* 上传任务入口(有任务时显示角标) */}
          <Badge dot={uploading} offset={[-4, 4]}>
            <Button
              type="text"
              className="rounded-xl px-3 text-muted hover:!bg-hover hover:!text-ink"
              icon={<CloudUploadOutlined />}
              onClick={() => setUploadOpen(true)}
            >
              {tasks.length > 0 ? `${tasks.length}` : ''}
            </Button>
          </Badge>
        </div>
      </Header>

      <Content className="app-shell__content flex flex-col gap-4 overflow-hidden px-6 py-5">
        <Toolbar
          connected={connected}
          selectionMode={selectionMode}
          selectedCount={selectedCount}
          hasDirectorySelection={hasDirectorySelection}
          onUpload={handleUpload}
          onCreateFolder={() => setCreateFolderOpen(true)}
          onRefresh={() => void refresh()}
          onOpenConfig={() => setConfigOpen(true)}
          onToggleSelectionMode={handleToggleSelectionMode}
          onBulkDelete={() => void handleBulkDelete()}
        />

        {connected && (
          <Breadcrumbs
            prefix={prefix}
            folderCount={directoryStats.folderCount}
            fileCount={directoryStats.fileCount}
            loading={loading}
            onNavigate={navigate}
          />
        )}

        <div className="flex-1 overflow-auto">
          <FileTable
            entries={entries}
            loading={loading}
            connected={connected}
            selectionMode={selectionMode}
            selectedRowKeys={selectedRowKeys}
            onSelectedRowKeysChange={setSelectedRowKeys}
            onNavigate={navigate}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onGenerateUrl={handleGenerateUrl}
          />
        </div>
      </Content>

      <ConfigDrawer
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        config={config}
        connecting={connecting}
        connectError={connectError}
        connected={connected}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      <UploadDrawer
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        tasks={tasks}
        uploading={uploading}
        onClearCompleted={clearCompleted}
      />

      <CreateFolderModal
        open={createFolderOpen}
        onCancel={() => setCreateFolderOpen(false)}
        onConfirm={handleCreateFolder}
      />

      <GenerateUrlModal
        open={generateUrlOpen}
        fileName={generateUrlEntry?.name ?? ''}
        onGenerate={handleGenerateUrlAction}
        onCancel={() => {
          setGenerateUrlOpen(false);
          setGenerateUrlEntry(null);
        }}
      />
    </Layout>
  );
};

/**
 * 应用根入口
 * - ConfigProvider:全局 Ant Design 主题(暖白纸感 + 雾蓝强调)
 * - AntdApp:提供全局 message / notification API
 */
const App: React.FC = () => (
  <ConfigProvider
    theme={{
      algorithm: theme.defaultAlgorithm,
      token: {
        colorPrimary: '#5c748c',
        colorBgLayout: '#fdfaf5',
        colorBgContainer: '#fffefb',
        colorBgElevated: '#fffefb',
        colorText: '#4f463c',
        colorTextSecondary: '#a8a094',
        colorBorder: '#f5efe5',
        colorBorderSecondary: '#faf5ed',
        colorFillAlter: '#fcf7ef',
        colorFillSecondary: '#fdfaf3',
        fontSize: 15,
        borderRadius: 10,
        borderRadiusLG: 14,
        controlHeight: 40,
        fontFamily:
          'Inter, SF Pro Display, SF Pro Text, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Segoe UI, sans-serif',
        boxShadowSecondary: '0 12px 30px rgba(79, 70, 60, 0.04)',
      },
      components: {
        Layout: {
          headerBg: '#fffefb',
        },
        Table: {
          headerBg: '#fdf8ef',
          headerColor: '#a8a094',
          borderColor: '#f7f1e7',
          rowHoverBg: '#fdf8ef',
          cellPaddingBlock: 14,
          cellPaddingInline: 16,
        },
        Button: {
          borderRadius: 12,
          paddingInline: 16,
          controlHeight: 38,
          defaultBorderColor: '#f1e9dc',
          defaultColor: '#6c645a',
        },
        Drawer: {
          footerPaddingInline: 24,
          footerPaddingBlock: 16,
        },
        Modal: {
          borderRadiusLG: 18,
        },
        Input: {
          controlHeight: 40,
        },
      },
    }}
  >
    <AntdApp>
      <AppInner />
    </AntdApp>
  </ConfigProvider>
);

export default App;
