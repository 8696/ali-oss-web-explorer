/**
 * Toolbar
 *
 * 文件浏览器顶部的操作工具栏。
 * 集成:上传、新建文件夹、多选模式、批量删除(经 {@link DeleteConfirmModal} 二次确认)、刷新、OSS 配置入口。
 * 批量删除失败时不关闭确认弹窗,由父组件 `onBulkDelete` 抛错;成功时本组件在 `onConfirm` 内关闭弹窗。
 * 使用 Ant Design 的 Space 与 Button 实现,间距由 Tailwind 控制。
 */

import React, { useRef, useState } from 'react';
import { Button, Space, Tooltip } from 'antd';
import {
  CheckSquareOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  FolderAddOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { DeleteConfirmModal } from '@/components/DeleteConfirmModal';

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
}) => {
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

  return (
    <div className="toolbar-panel flex items-center justify-between gap-3 flex-wrap">
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
      <Space size={8} className="toolbar-actions">
        <Button
          type="primary"
          icon={<CloudUploadOutlined />}
          disabled={!connected}
          onClick={() => fileInputRef.current?.click()}
        >
          上传文件
        </Button>
        <Button
          icon={<FolderAddOutlined />}
          disabled={!connected}
          onClick={onCreateFolder}
        >
          新建文件夹
        </Button>
        <Button
          icon={<CheckSquareOutlined />}
          disabled={!connected}
          onClick={onToggleSelectionMode}
        >
          {selectionMode ? '取消选择' : '选择文件'}
        </Button>
        {selectionMode &&
          (bulkDeleteDisabled ? (
            <Tooltip title={bulkDeleteTooltip}>
              <span className="inline-block">
                <Button danger icon={<DeleteOutlined />} disabled>
                  {`删除已选（${selectedCount}）`}
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={() => setBulkDeleteOpen(true)}
            >
              {`删除已选（${selectedCount}）`}
            </Button>
          ))}
        <Tooltip title="刷新当前目录">
          <Button
            icon={<ReloadOutlined />}
            disabled={!connected}
            onClick={onRefresh}
          />
        </Tooltip>
      </Space>

      <Tooltip title="OSS 连接配置">
        <Button
          type="text"
          className="rounded-xl px-3 text-muted hover:!bg-hover hover:!text-ink"
          icon={<SettingOutlined />}
          onClick={onOpenConfig}
        >
          连接配置
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
