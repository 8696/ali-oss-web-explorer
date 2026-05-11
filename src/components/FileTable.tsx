/**
 * FileTable
 *
 * 文件浏览器核心组件。
 * 使用 Ant Design Table 展示当前目录下的文件和子目录。
 * 支持单击目录进入下级、单击文件名预览、操作列下载、链接、ACL、删除与重命名。
 *
 * 设计思路:
 *   - 列配置与渲染逻辑集中在此组件内;
 *   - 文件图标通过 resolveFileIcon 获取;
 *   - 行为(导航、下载、删除、重命名)通过 props 的回调上报给父组件。
 */

import React, { useCallback } from 'react';
import { Table, Button, Popconfirm, Typography, Empty, Tooltip } from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  FormOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { TableRowSelection } from 'antd/es/table/interface';
import type { FileEntry } from '@/types/oss';
import { formatDateTime, formatFileSize } from '@/utils/format';
import { resolveFileIcon } from '@/components/fileIcon';

export interface FileTableProps {
  /** 文件与目录列表 */
  entries: FileEntry[];
  /** 是否加载中 */
  loading: boolean;
  /** 是否已连接(未连接时显示空状态引导) */
  connected: boolean;
  /** 是否处于选择模式 */
  selectionMode: boolean;
  /** 当前选中的 key */
  selectedRowKeys: React.Key[];
  /** 更新选中的 key */
  onSelectedRowKeysChange: (keys: React.Key[]) => void;
  /** 点击目录,触发导航 */
  onNavigate: (prefix: string) => void;
  /** 点击文件名/行:新标签页预览(或浏览器自行处理) */
  onPreviewFile: (entry: FileEntry) => void;
  /** 操作列下载:带 attachment 的签名 URL,强制保存文件 */
  onDownloadFile: (entry: FileEntry) => void;
  /** 删除条目 */
  onDelete: (entry: FileEntry) => void;
  /** 重命名条目:打开弹窗或跳转至重命名流程,由父组件实现 */
  onRename: (entry: FileEntry) => void;
  /** 生成访问链接 */
  onGenerateUrl: (entry: FileEntry) => void;
  /** 查看并修改对象 ACL(仅文件) */
  onObjectAcl: (entry: FileEntry) => void;
}

export const FileTable: React.FC<FileTableProps> = ({
  entries,
  loading,
  connected,
  selectionMode,
  selectedRowKeys,
  onSelectedRowKeysChange,
  onNavigate,
  onPreviewFile,
  onDownloadFile,
  onDelete,
  onRename,
  onGenerateUrl,
  onObjectAcl,
}) => {
  const handleRowClick = useCallback(
    (record: FileEntry) => {
      if (selectionMode) return;
      if (record.type === 'directory') {
        onNavigate(record.path);
      } else {
        onPreviewFile(record);
      }
    },
    [selectionMode, onNavigate, onPreviewFile],
  );

  const columns: ColumnsType<FileEntry> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      render: (name: string, record: FileEntry) => {
        const isFolder = record.type === 'directory';
        const { Component, color } = resolveFileIcon(name, isFolder);
        return (
          <span
            className="file-row-trigger"
            onClick={() => handleRowClick(record)}
          >
            <span className="file-icon-chip">
              <Component style={{ color, fontSize: isFolder ? 18 : 16 }} />
            </span>
            <span className={`file-name ${isFolder ? 'font-medium' : ''}`}>{name}</span>
          </span>
        );
      },
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 132,
      align: 'right',
      render: (size: number, record: FileEntry) => (
        <span className="text-sm text-muted">
          {record.type === 'directory' ? '-' : formatFileSize(size)}
        </span>
      ),
    },
    {
      title: '修改时间',
      dataIndex: 'lastModified',
      key: 'lastModified',
      width: 196,
      render: (val: string | undefined, record: FileEntry) => (
        <span className="text-sm text-muted">
          {record.type === 'directory' ? '-' : formatDateTime(val)}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 188,
      align: 'right',
      render: (_: unknown, record: FileEntry) => (
        <div className="file-actions">
          {record.type === 'file' && (
            <>
              <Tooltip title="下载">
                <Button
                  type="text"
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownloadFile(record);
                  }}
                />
              </Tooltip>
              <Tooltip title="生成链接">
                <Button
                  type="text"
                  size="small"
                  icon={<LinkOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onGenerateUrl(record);
                  }}
                />
              </Tooltip>
              <Tooltip title="读写权限">
                <Button
                  type="text"
                  size="small"
                  icon={<SafetyCertificateOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onObjectAcl(record);
                  }}
                />
              </Tooltip>
            </>
          )}
          {/* 文件与目录均支持重命名;目录在 OSS 侧为批量 copy + deleteMulti,故目录需二次确认 */}
          {record.type === 'directory' ? (
            <Popconfirm
              title="确认重命名该文件夹?"
              description="通过多次复制与删除完成,非原子操作;中途失败可能在新旧路径下残留部分对象。重要数据请先备份。"
              okText="继续"
              cancelText="取消"
              onConfirm={() => onRename(record)}
            >
              <Tooltip title="重命名">
                <Button
                  type="text"
                  size="small"
                  icon={<FormOutlined />}
                  onClick={(e) => e.stopPropagation()}
                />
              </Tooltip>
            </Popconfirm>
          ) : (
            <Tooltip title="重命名">
              <Button
                type="text"
                size="small"
                icon={<FormOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(record);
                }}
              />
            </Tooltip>
          )}
          <Popconfirm
            title={
              record.type === 'directory'
                ? `确定删除文件夹「${record.name}」及其全部内容?`
                : `确定删除「${record.name}」?`
            }
            onConfirm={() => onDelete(record)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="删除">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => e.stopPropagation()}
              />
            </Tooltip>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const rowSelection: TableRowSelection<FileEntry> | undefined = selectionMode
    ? {
      selectedRowKeys,
      onChange: (nextSelectedRowKeys) => onSelectedRowKeysChange(nextSelectedRowKeys),
    }
    : undefined;

  return (
    <Table<FileEntry>
      dataSource={entries}
      columns={columns}
      rowKey="key"
      rowSelection={rowSelection}
      loading={loading}
      size="middle"
      pagination={false}
      className="modern-file-table flex-1"
      locale={{
        emptyText: connected ? (
          <Empty description="当前目录为空" />
        ) : (
          <Empty
            description={
              <Typography.Text type="secondary">
                请先点击右上角
                <SettingOutlined className="mx-1" />
                配置 OSS 连接
              </Typography.Text>
            }
          />
        ),
      }}
    />
  );
};

function SettingOutlined(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      viewBox="64 64 896 896"
      width="1em"
      height="1em"
      fill="currentColor"
    >
      <path d="M924.8 625.7l-65.5-56c3.1-19 4.7-38.4 4.7-57.8s-1.6-38.8-4.7-57.8l65.5-56a32.03 32.03 0 009.3-35.2l-.9-2.6a443.74 443.74 0 00-79.7-137.9l-1.8-2.1a32.12 32.12 0 00-35.1-9.5l-81.3 28.9c-30-20.7-63.1-37.2-98.6-48.9l-15.7-85a32.05 32.05 0 00-25.8-25.7l-2.7-.5c-52.1-9.4-106.9-9.4-159 0l-2.7.5a32.05 32.05 0 00-25.8 25.7l-15.8 85.4a351.86 351.86 0 00-98.4 48.8L159 218.1a32.06 32.06 0 00-35.1 9.5l-1.8 2.1a446.02 446.02 0 00-79.7 137.9l-.9 2.6c-4.5 12.5-.8 26.5 9.3 35.2l66.3 56.6c-3.1 18.8-4.6 38-4.6 57.1 0 19.2 1.5 38.4 4.6 57.1L51 625.5a32.03 32.03 0 00-9.3 35.2l.9 2.6c18.1 50.4 44.9 96.9 79.7 137.9l1.8 2.1a32.12 32.12 0 0035.1 9.5l81.3-28.9c30 20.7 63.1 37.2 98.6 48.9l15.7 85a32.05 32.05 0 0025.8 25.7l2.7.5a449.4 449.4 0 00159 0l2.7-.5a32.05 32.05 0 0025.8-25.7l15.7-85a351.86 351.86 0 0098.4-48.8l81.4 28.9a32.06 32.06 0 0035.1-9.5l1.8-2.1c34.8-41.1 61.6-87.5 79.7-137.9l.9-2.6c4.5-12.3.8-26.2-9.3-35zM512 680c-92.6 0-168-75.4-168-168s75.4-168 168-168 168 75.4 168 168-75.4 168-168 168z" />
    </svg>
  );
}
