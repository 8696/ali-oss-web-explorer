/**
 * App
 *
 * 应用根组件,职责:
 *   1. 组装所有 Hooks(Config / Client / Files / Upload);
 *   2. 作为唯一的状态提升层,把各 Hook 的输入输出连接起来;
 *   3. 渲染子组件(Toolbar / Breadcrumbs / FileTable / 各种弹窗,含重命名与粘贴进度);
 *   4. 不包含复杂 UI 逻辑,仅做"接线"工作。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ObjectAclModal } from '@/components/ObjectAclModal';
import { PasteProgressModal, buildInitialPasteProgress } from '@/components/PasteProgressModal';
import { RenameModal } from '@/components/RenameModal';
import { RECYCLE_BIN_FOLDER, isRecycleBinDirectoryEntry } from '@/constants/recycleBin';
import { getObjectAcl, getSignedAccessUrl, getSignedUrl, putObjectAcl } from '@/services/oss';
import type {
  FileClipboardState,
  FileEntry,
  ObjectAcl,
  PasteProgress,
  RenameDirectoryProgress,
} from '@/types/oss';
import { extractName } from '@/utils/format';

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
  const {
    prefix,
    entries,
    loading,
    error: listError,
    navigate,
    refresh,
    createFolder,
    removeEntry,
    removeEntries,
    renameEntry,
    pasteClipboard,
  } = useOSSFiles(client);

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
  /** 重命名弹窗是否打开 */
  const [renameOpen, setRenameOpen] = useState(false);
  /** 当前正在重命名的条目;关闭弹窗或成功后置 null */
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  /** 目录重命名时 OSS 复制/删除进度,单文件重命名不使用 */
  const [renameDirProgress, setRenameDirProgress] = useState<RenameDirectoryProgress | null>(null);
  /** 对象 ACL 弹窗目标(仅文件) */
  const [objectAclEntry, setObjectAclEntry] = useState<FileEntry | null>(null);
  /**
   * 复制 / 剪切剪贴板（内存态，不落盘）。
   * - `entries` 为列表快照；粘贴目标目录为当前 `prefix`（见 `handlePasteToCurrentDirectory`）。
   * - 成功粘贴后清空；断开 OSS、选中回收站相关约束见各处的 `setClipboard(null)` / 禁用逻辑。
   */
  const [clipboard, setClipboard] = useState<FileClipboardState | null>(null);
  /** 粘贴或剪切移动进行中时置 true，驱动 {@link PasteProgressModal} */
  const [pasteModalOpen, setPasteModalOpen] = useState(false);
  /** 弹窗内展示的聚合进度（当前条目 + 当前阶段 copy/delete 的子进度） */
  const [pasteProgress, setPasteProgress] = useState<PasteProgress | null>(null);
  /**
   * OSS 粘贴过程中 `onPasteProgress` 回调频率极高（每个对象一次）。
   * 用「始终写入 ref + 最多每 100ms flush 一次到 React state」节流，避免进度条与 Modal 闪烁。
   */
  const pasteProgressThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 节流窗口内最后一次进度，flush 时一次性写入 state，避免丢失尾部进度 */
  const latestPasteProgressRef = useRef<PasteProgress | null>(null);

  /**
   * 粘贴进度节流回调：每次 OSS 上报先更新 `latestPasteProgressRef`，再在首个定时器触发时把最新值同步到 UI。
   */
  const onPasteProgressThrottled = useCallback((p: PasteProgress) => {
    latestPasteProgressRef.current = p;
    if (pasteProgressThrottleRef.current !== null) return;
    pasteProgressThrottleRef.current = setTimeout(() => {
      pasteProgressThrottleRef.current = null;
      const v = latestPasteProgressRef.current;
      if (v !== null) {
        setPasteProgress(v);
      }
    }, 100);
  }, []);

  /**
   * 当前目录的文件统计
   * 从已加载的 entries 中拆分出文件夹数和文件数,用于在面包屑右侧展示。
   */
  const directoryStats = useMemo(() => {
    const folderCount = entries.filter((entry) => entry.type === 'directory').length;
    const fileCount = entries.filter((entry) => entry.type === 'file').length;
    return { folderCount, fileCount };
  }, [entries]);

  /**
   * 当前多选模式下、与 `selectedRowKeys` 对应的完整条目列表
   * (用于批量删除入参及是否包含目录/系统回收站的判断)
   */
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedRowKeys.includes(entry.key)),
    [entries, selectedRowKeys],
  );

  const selectedCount = selectedEntries.length;
  const hasDirectorySelection = useMemo(
    () => selectedEntries.some((entry) => entry.type === 'directory'),
    [selectedEntries],
  );

  /**
   * 无选中项,或选中项中含桶根「回收站」系统目录时禁用批量删除
   * (后者在服务端也会被拒绝,UI 侧提前禁用并 Tooltip 说明)
   */
  const bulkDeleteDisabled = useMemo(
    () =>
      selectedCount === 0 || selectedEntries.some((entry) => isRecycleBinDirectoryEntry(entry)),
    [selectedCount, selectedEntries],
  );

  /**
   * 无选中项，或选中项中含桶根「回收站」系统目录时禁用批量复制与剪切
   * （与 `bulkDeleteDisabled` 规则一致：避免误操作系统虚拟目录）
   */
  const bulkClipboardDisabled = useMemo(
    () =>
      selectedCount === 0 || selectedEntries.some((entry) => isRecycleBinDirectoryEntry(entry)),
    [selectedCount, selectedEntries],
  );

  /** 已有剪贴板内容时工具栏展示「粘贴」，目标目录始终为当前浏览 `prefix` */
  const clipboardReady = clipboard !== null && clipboard.entries.length > 0;

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
    setClipboard(null);
    message.info('已断开 OSS 连接');
  }, [clearConfig, message]);

  /**
   * 将选中项写入剪贴板为「复制」：仅保存条目引用，真实 OSS copy 发生在粘贴阶段。
   * 成功后退出多选模式，避免用户误以为仍需保持勾选。
   */
  const handleCopyToClipboard = useCallback(
    (items: FileEntry[]) => {
      if (items.length === 0) return;
      setClipboard({ operation: 'copy', entries: [...items] });
      message.success(items.length > 1 ? `已复制 ${items.length} 项` : '已复制');
      setSelectedRowKeys([]);
      setSelectionMode(false);
    },
    [message],
  );

  /**
   * 将选中项写入剪贴板为「剪切」：粘贴时先复制到目标再删源（目录为整树复制后删源前缀）。
   * 成功后同样退出多选模式。
   */
  const handleCutToClipboard = useCallback(
    (items: FileEntry[]) => {
      if (items.length === 0) return;
      setClipboard({ operation: 'cut', entries: [...items] });
      message.success(items.length > 1 ? `已剪切 ${items.length} 项` : '已剪切');
      setSelectedRowKeys([]);
      setSelectionMode(false);
    },
    [message],
  );

  /**
   * 把剪贴板中的条目粘贴到**当前列表所在目录**（`prefix`）。
   * 流程：重置节流定时器 → 展示占位进度 → 调用 `pasteClipboard` → 成功则清空剪贴板；
   * `finally` 里刷新尾部进度、关弹窗并清空节流状态，避免关闭瞬间进度条回跳。
   */
  const handlePasteToCurrentDirectory = useCallback(async () => {
    if (!clipboard || clipboard.entries.length === 0) return;
    latestPasteProgressRef.current = null;
    if (pasteProgressThrottleRef.current !== null) {
      clearTimeout(pasteProgressThrottleRef.current);
      pasteProgressThrottleRef.current = null;
    }
    setPasteProgress(buildInitialPasteProgress(clipboard));
    setPasteModalOpen(true);
    try {
      await pasteClipboard(
        clipboard.entries,
        clipboard.operation,
        prefix,
        onPasteProgressThrottled,
      );
      message.success(clipboard.operation === 'cut' ? '已移动' : '已粘贴');
      setClipboard(null);
      setSelectedRowKeys([]);
      setSelectionMode(false);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '粘贴失败');
    } finally {
      if (pasteProgressThrottleRef.current !== null) {
        clearTimeout(pasteProgressThrottleRef.current);
        pasteProgressThrottleRef.current = null;
      }
      const tail = latestPasteProgressRef.current;
      if (tail !== null) {
        setPasteProgress(tail);
      }
      setPasteModalOpen(false);
      setPasteProgress(null);
      latestPasteProgressRef.current = null;
    }
  }, [clipboard, onPasteProgressThrottled, pasteClipboard, message, prefix]);

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
   * 点击文件名:新标签页打开，浏览器能预览的直接展示，不能的自动下载
   */
  const handlePreviewFile = useCallback(
    (entry: FileEntry) => {
      if (!client) return;
      try {
        const url = getSignedAccessUrl(client, entry.path, 600);
        window.open(url, '_blank');
      } catch (err) {
        message.error('操作失败');
        console.error('[handlePreviewFile]', err);
      }
    },
    [client, message],
  );

  /**
   * 操作列下载:签名 URL 带 Content-Disposition: attachment，与「仅预览」区分开
   */
  const handleDownloadFile = useCallback(
    (entry: FileEntry) => {
      if (!client) return;
      try {
        const url = getSignedUrl(client, entry.path, 600);
        window.open(url, '_blank');
      } catch (err) {
        message.error('下载失败');
        console.error('[handleDownloadFile]', err);
      }
    },
    [client, message],
  );

  /**
   * 删除文件/目录
   *
   * `removeEntry` 在非回收站路径下会先同桶备份到 `回收站/{时间戳}/` 再删;
   * `backedUp === false` 表示源已在回收站树下,仅直接删除。失败时抛错供表格确认弹窗保持打开。
   */
  const handleDelete = useCallback(
    async (entry: FileEntry) => {
      try {
        const { backedUp } = await removeEntry(entry);
        setSelectedRowKeys((currentKeys) => currentKeys.filter((key) => key !== entry.key));
        message.success(
          backedUp
            ? `已备份至「${RECYCLE_BIN_FOLDER}」并删除 ${entry.name}`
            : `已删除 ${entry.name}`,
        );
      } catch (err) {
        message.error(err instanceof Error ? err.message : '删除失败');
        throw err;
      }
    },
    [removeEntry, message],
  );

  /**
   * 批量删除当前多选项
   * 成功后清空选择与选择模式;提示文案与单行删除一致区分是否经过回收站备份。
   */
  const handleBulkDelete = useCallback(async () => {
    if (selectedEntries.length === 0) return;

    try {
      const { backedUp } = await removeEntries(selectedEntries);
      setSelectedRowKeys([]);
      setSelectionMode(false);
      message.success(
        backedUp
          ? `已备份至「${RECYCLE_BIN_FOLDER}」并删除 ${selectedEntries.length} 项`
          : `已删除 ${selectedEntries.length} 项`,
      );
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : '批量删除失败，部分对象可能已删除，请刷新后确认',
      );
      throw err;
    }
  }, [removeEntries, selectedEntries, message, setSelectionMode]);

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
      try {
        await createFolder(name);
        message.success(`文件夹「${name}」已创建`);
        setCreateFolderOpen(false);
      } catch (err) {
        message.error(err instanceof Error ? err.message : '创建文件夹失败');
      }
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

  /**
   * 打开对象 ACL 弹窗(仅文件行展示入口)
   */
  const handleOpenObjectAcl = useCallback((entry: FileEntry) => {
    if (entry.type !== 'file') return;
    setObjectAclEntry(entry);
  }, []);

  const handleFetchObjectAcl = useCallback(
    (objectKey: string) => {
      if (!client) {
        return Promise.reject(new Error('未连接 OSS'));
      }
      return getObjectAcl(client, objectKey);
    },
    [client],
  );

  const handleSaveObjectAcl = useCallback(
    async (objectKey: string, acl: ObjectAcl) => {
      if (!client) {
        throw new Error('未连接 OSS');
      }
      await putObjectAcl(client, objectKey, acl);
      message.success('权限已更新');
    },
    [client, message],
  );

  const handleObjectAclModalCancel = useCallback(() => {
    setObjectAclEntry(null);
  }, []);

  /**
   * 打开重命名弹窗并记录目标条目
   */
  const handleOpenRename = useCallback((entry: FileEntry) => {
    setRenameDirProgress(null);
    setRenameTarget(entry);
    setRenameOpen(true);
  }, []);

  /**
   * 重命名确认:调用 Hook 内 renameEntry,成功后刷新由 Hook 完成
   *
   * - 若该行处于多选选中状态,将 `selectedRowKeys` 中对应的旧 key 替换为 `newPath`,避免勾选状态失效;
   * - 成功提示使用 `extractName(newPath)` 展示最终名称(目录无尾斜杠的展示与列表一致)。
   * - 失败时 `message.error` 后向上抛出,弹窗保留表单输入;目录失败时附加控制台排查提示。
   */
  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;
      setRenameDirProgress(null);
      try {
        const { newPath } = await renameEntry(
          renameTarget,
          newName,
          renameTarget.type === 'directory' ? (p) => setRenameDirProgress(p) : undefined,
        );
        setSelectedRowKeys((keys) =>
          keys.includes(renameTarget.key) ? keys.map((k) => (k === renameTarget.key ? newPath : k)) : keys,
        );
        message.success(`已重命名为「${extractName(newPath)}」`);
        setRenameOpen(false);
        setRenameTarget(null);
      } catch (err) {
        const base = err instanceof Error ? err.message : '重命名失败';
        const dirHint =
          renameTarget.type === 'directory'
            ? ' 若操作未完成，请到 OSS 控制台检查新旧路径下是否残留部分对象。'
            : '';
        message.error(base + dirHint);
        throw err;
      } finally {
        setRenameDirProgress(null);
      }
    },
    [renameEntry, renameTarget, message],
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

  /** 失去 OSS 连接时清空剪贴板，避免断连后仍尝试粘贴导致误导性错误 */
  useEffect(() => {
    if (!connected) {
      setSelectionMode(false);
      setSelectedRowKeys([]);
      setClipboard(null);
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
          bulkDeleteDisabled={bulkDeleteDisabled}
          bulkClipboardDisabled={bulkClipboardDisabled}
          clipboardReady={clipboardReady}
          pasteEntryCount={clipboard?.entries.length ?? 0}
          pasteIsMove={clipboard?.operation === 'cut'}
          onUpload={handleUpload}
          onCreateFolder={() => setCreateFolderOpen(true)}
          onRefresh={() => void refresh()}
          onOpenConfig={() => setConfigOpen(true)}
          onToggleSelectionMode={handleToggleSelectionMode}
          onBulkDelete={handleBulkDelete}
          onBulkCopy={() => handleCopyToClipboard(selectedEntries)}
          onBulkCut={() => handleCutToClipboard(selectedEntries)}
          onPaste={handlePasteToCurrentDirectory}
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
            onPreviewFile={handlePreviewFile}
            onDownloadFile={handleDownloadFile}
            onDelete={handleDelete}
            onRename={handleOpenRename}
            onGenerateUrl={handleGenerateUrl}
            onObjectAcl={handleOpenObjectAcl}
            onCopyEntry={(entry) => handleCopyToClipboard([entry])}
            onCutEntry={(entry) => handleCutToClipboard([entry])}
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

      <ObjectAclModal
        open={!!objectAclEntry}
        entry={objectAclEntry}
        onFetchAcl={handleFetchObjectAcl}
        onSaveAcl={handleSaveObjectAcl}
        onCancel={handleObjectAclModalCancel}
      />

      {/* 单文件/单目录重命名:表单仅收集新名称,OSS 侧见 services/oss.renameEntry */}
      <RenameModal
        open={renameOpen}
        entry={renameTarget}
        directoryProgress={renameDirProgress}
        onCancel={() => {
          setRenameOpen(false);
          setRenameTarget(null);
          setRenameDirProgress(null);
        }}
        onConfirm={handleRenameConfirm}
      />

      {/* 复制/剪切粘贴过程中的阻塞式进度（不可手动关闭，完成后由 handlePasteToCurrentDirectory 关闭） */}
      <PasteProgressModal open={pasteModalOpen} progress={pasteProgress} />
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
