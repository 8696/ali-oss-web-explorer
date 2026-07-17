/**
 * Toolbar
 *
 * 文件浏览器顶部的操作工具栏。
 * 集成:上传、新建文件夹、多选模式、批量剪切/复制与粘贴到当前目录(粘贴前 Popconfirm)、批量删除(经 {@link DeleteConfirmModal} 二次确认)、刷新、OSS 配置入口。
 * 批量删除失败时不关闭确认弹窗,由父组件 `onBulkDelete` 抛错;成功时本组件在 `onConfirm` 内关闭弹窗。
 * 移动端以图标按钮为主,减少横向占位;桌面端保留完整文案。
 */

import React, { useRef, useState } from 'react';
import { Button, Popconfirm, Space, Tooltip } from 'antd';
import {
  CheckSquareOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  FolderAddOutlined,
  ReloadOutlined,
  ScissorOutlined,
  SettingOutlined,
  SnippetsOutlined,
} from '@ant-design/icons';
import { DeleteConfirmModal } from '@/components/DeleteConfirmModal';
import { useIsMobile } from '@/hooks/useIsMobile';

export interface ToolbarProps {
  /** 是否已连接 */
  connected: boolean;
  /** 是否处于选择模式 */
  selectionMode: boolean;
  /** 当前选中数量 */
  selectedCount: number;
  /** 选中项中是否包含目录 */
  hasDirectorySelection: boolean;
  /** 批量删除按钮是否禁用(无选中或含「回收站」文件夹) */
  bulkDeleteDisabled: boolean;
  /** 触发文件选择器 */
  onUpload: (files: File[]) => void;
  /** 打开新建文件夹弹窗 */
  onCreateFolder: () => void;
  /** 刷新当前列表 */
  onRefresh: () => void;
  /** 打开配置抽屉 */
  onOpenConfig: () => void;
  /** 切换选择模式 */
  onToggleSelectionMode: () => void;
  /** 批量删除已选项 */
  onBulkDelete: () => void | Promise<void>;
  /** 批量复制到剪贴板是否不可用(无选中或含桶根「回收站」目录) */
  bulkClipboardDisabled: boolean;
  /** 批量复制当前选中项 */
  onBulkCopy: () => void;
  /** 批量剪切当前选中项 */
  onBulkCut: () => void;
  /** 是否已有复制或剪切内容，用于显示「粘贴」 */
  clipboardReady: boolean;
  /** 剪贴板内条目数，用于粘贴确认文案 */
  pasteEntryCount: number;
  /** 是否为剪切（移动），否则为复制粘贴 */
  pasteIsMove: boolean;
  /** 粘贴到当前目录 */
  onPaste: () => void | Promise<void>;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  connected,
  selectionMode,
  selectedCount,
  hasDirectorySelection,
  bulkDeleteDisabled,
  onUpload,
  onCreateFolder,
  onRefresh,
  onOpenConfig,
  onToggleSelectionMode,
  onBulkDelete,
  bulkClipboardDisabled,
  onBulkCopy,
  onBulkCut,
  clipboardReady,
  pasteEntryCount,
  pasteIsMove,
  onPaste,
}) => {
  const isMobile = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 批量删除确认弹窗开关;打开时由 {@link DeleteConfirmModal} 要求用户输入「确定删除」 */
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onUpload(Array.from(files));
    }
    e.target.value = '';
  };

  /** 弹窗主文案:含目录时提示将递归删除,避免用户误以为只删「空壳」文件夹 */
  const bulkDeleteTitle = hasDirectorySelection
    ? `将删除已选 ${selectedCount} 项。其中包含文件夹，将递归删除其全部内容。`
    : `将删除已选 ${selectedCount} 项。`;

  /** 禁用批量删除时给按钮包一层 Tooltip,说明是无选中还是误选了系统「回收站」目录 */
  const bulkDeleteTooltip = bulkDeleteDisabled
    ? selectedCount === 0
      ? '请先选择要删除的项'
      : '选中了「回收站」系统文件夹，无法批量删除'
    : undefined;

  /** 与 `bulkDeleteTooltip` 同理：无选中或选中桶根「回收站」时禁用并提示原因 */
  const bulkClipboardTooltip = bulkClipboardDisabled
    ? selectedCount === 0
      ? '请先选择要复制或剪切的项'
      : '选中了「回收站」系统文件夹，无法复制或剪切'
    : undefined;

  const selectLabel = selectionMode ? '取消选择' : '选择文件';
  const selectTooltip = selectionMode
    ? selectedCount > 0
      ? `取消选择（已选 ${selectedCount}）`
      : '取消选择'
    : '选择文件';

  return (
    <div className="toolbar-panel flex items-center justify-between gap-2 flex-wrap md:gap-3">
      <DeleteConfirmModal
        open={bulkDeleteOpen}
        title={bulkDeleteTitle}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={async () => {
          try {
            await onBulkDelete();
            setBulkDeleteOpen(false);
          } catch (err) {
            console.error('[Toolbar] 批量删除确认失败', err);
            /* 错误提示由 App.handleBulkDelete 负责 */
          }
        }}
      />
      <Space size={isMobile ? 6 : 8} className="toolbar-actions flex-wrap" wrap>
        <Tooltip title={isMobile ? '上传文件' : undefined}>
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            disabled={!connected}
            onClick={() => fileInputRef.current?.click()}
            aria-label="上传文件"
          >
            {isMobile ? null : '上传文件'}
          </Button>
        </Tooltip>
        <Tooltip title={isMobile ? '新建文件夹' : undefined}>
          <Button
            icon={<FolderAddOutlined />}
            disabled={!connected}
            onClick={onCreateFolder}
            aria-label="新建文件夹"
          >
            {isMobile ? null : '新建文件夹'}
          </Button>
        </Tooltip>
        <Tooltip title={isMobile ? selectTooltip : undefined}>
          <Button
            icon={<CheckSquareOutlined />}
            disabled={!connected}
            onClick={onToggleSelectionMode}
            aria-label={selectTooltip}
          >
            {isMobile ? null : selectLabel}
          </Button>
        </Tooltip>
        {/* 多选模式下批量写入剪贴板；禁用态需包一层 span，Tooltip 才能绑定到禁用按钮上 */}
        {selectionMode &&
          (bulkClipboardDisabled ? (
            <Tooltip title={bulkClipboardTooltip}>
              <span className="inline-flex gap-1">
                <Button icon={<ScissorOutlined />} disabled aria-label="剪切已选">
                  {isMobile ? null : `剪切已选（${selectedCount}）`}
                </Button>
                <Button icon={<CopyOutlined />} disabled aria-label="复制已选">
                  {isMobile ? null : `复制已选（${selectedCount}）`}
                </Button>
              </span>
            </Tooltip>
          ) : (
            <>
              <Tooltip title={isMobile ? `剪切已选（${selectedCount}）` : undefined}>
                <Button
                  icon={<ScissorOutlined />}
                  onClick={onBulkCut}
                  aria-label={`剪切已选（${selectedCount}）`}
                >
                  {isMobile ? null : `剪切已选（${selectedCount}）`}
                </Button>
              </Tooltip>
              <Tooltip title={isMobile ? `复制已选（${selectedCount}）` : undefined}>
                <Button
                  icon={<CopyOutlined />}
                  onClick={onBulkCopy}
                  aria-label={`复制已选（${selectedCount}）`}
                >
                  {isMobile ? null : `复制已选（${selectedCount}）`}
                </Button>
              </Tooltip>
            </>
          ))}
        {selectionMode &&
          (bulkDeleteDisabled ? (
            <Tooltip title={bulkDeleteTooltip}>
              <span className="inline-block">
                <Button danger icon={<DeleteOutlined />} disabled aria-label="删除已选">
                  {isMobile ? null : `删除已选（${selectedCount}）`}
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Tooltip title={isMobile ? `删除已选（${selectedCount}）` : undefined}>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={() => setBulkDeleteOpen(true)}
                aria-label={`删除已选（${selectedCount}）`}
              >
                {isMobile ? null : `删除已选（${selectedCount}）`}
              </Button>
            </Tooltip>
          ))}
        {/* 有剪贴板内容即显示；粘贴目标固定为当前列表目录（由 App 传入的 prefix），未连接时禁用 */}
        {clipboardReady && (
          <Tooltip title="粘贴到当前目录">
            <Popconfirm
              title="确认粘贴？"
              description={
                pasteIsMove
                  ? `将把剪切的 ${pasteEntryCount} 项移动到当前目录；含文件夹时耗时可能较久，是否继续？`
                  : `将把复制的 ${pasteEntryCount} 项粘贴到当前目录；含文件夹时耗时可能较久，是否继续？`
              }
              okText="粘贴"
              cancelText="取消"
              disabled={!connected}
              onConfirm={() => void onPaste()}
            >
              <Button icon={<SnippetsOutlined />} disabled={!connected} aria-label="粘贴">
                {isMobile ? null : '粘贴'}
              </Button>
            </Popconfirm>
          </Tooltip>
        )}
        <Tooltip title="刷新当前目录">
          <Button
            icon={<ReloadOutlined />}
            disabled={!connected}
            onClick={onRefresh}
            aria-label="刷新当前目录"
          />
        </Tooltip>
      </Space>

      <Tooltip title="OSS 连接配置">
        <Button
          type="text"
          className="rounded-xl px-2 text-muted hover:!bg-hover hover:!text-ink md:px-3"
          icon={<SettingOutlined />}
          onClick={onOpenConfig}
          aria-label="连接配置"
        >
          {isMobile ? null : '连接配置'}
        </Button>
      </Tooltip>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
};
