/**
 * Toolbar
 *
 * 文件浏览器顶部的操作工具栏。
 * 集成:上传、新建文件夹、刷新、OSS 配置入口。
 * 使用 Ant Design 的 Flex 与 Button 实现,间距由 Tailwind 控制。
 */

import React, { useRef } from 'react';
import { Button, Popconfirm, Space, Tooltip } from 'antd';
import {
  CheckSquareOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  FolderAddOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';

export interface ToolbarProps {
  /** 是否已连接 */
  connected: boolean;
  /** 是否处于选择模式 */
  selectionMode: boolean;
  /** 当前选中数量 */
  selectedCount: number;
  /** 选中项中是否包含目录 */
  hasDirectorySelection: boolean;
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
  onBulkDelete: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  connected,
  selectionMode,
  selectedCount,
  hasDirectorySelection,
  onUpload,
  onCreateFolder,
  onRefresh,
  onOpenConfig,
  onToggleSelectionMode,
  onBulkDelete,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onUpload(Array.from(files));
    }
    e.target.value = '';
  };

  const bulkDeleteTitle = hasDirectorySelection
    ? `确定删除已选 ${selectedCount} 项吗？其中包含文件夹，将递归删除其全部内容。`
    : `确定删除已选 ${selectedCount} 项吗？`;

  return (
    <div className="toolbar-panel flex items-center justify-between gap-3 flex-wrap">
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
        {selectionMode && (
          <Popconfirm
            title={bulkDeleteTitle}
            onConfirm={onBulkDelete}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true, disabled: selectedCount === 0 }}
            disabled={selectedCount === 0}
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={selectedCount === 0}
            >
              {`删除已选（${selectedCount}）`}
            </Button>
          </Popconfirm>
        )}
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
