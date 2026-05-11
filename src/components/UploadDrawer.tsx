/**
 * UploadDrawer
 *
 * 上传任务面板(右侧抽屉)。
 * 展示当前所有上传任务及其进度,支持清除已完成的记录。
 * 每个任务显示:文件名、进度条、状态标签。
 */

import React from 'react';
import { Drawer, Button, Space, Progress, Tag, Empty } from 'antd';
import {
  CloudUploadOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import type { UploadTask } from '@/types/oss';
import { formatFileSize } from '@/utils/format';

export interface UploadDrawerProps {
  /** 抽屉是否可见 */
  open: boolean;
  /** 关闭抽屉 */
  onClose: () => void;
  /** 上传任务列表 */
  tasks: UploadTask[];
  /** 是否有正在上传的任务 */
  uploading: boolean;
  /** 清除已完成的任务 */
  onClearCompleted: () => void;
}

/**
 * 状态到 Tag 颜色的映射
 */
const STATUS_TAG_MAP: Record<UploadTask['status'], { color: string; label: string }> = {
  waiting: { color: 'default', label: '等待中' },
  uploading: { color: 'processing', label: '上传中' },
  success: { color: 'success', label: '完成' },
  error: { color: 'error', label: '失败' },
};

export const UploadDrawer: React.FC<UploadDrawerProps> = ({
  open,
  onClose,
  tasks,
  uploading,
  onClearCompleted,
}) => {
  // 统计已完成(成功/失败/取消)的任务数
  const completedCount = tasks.filter(
    (t) => t.status === 'success' || t.status === 'error',
  ).length;

  return (
    <Drawer
      className="upload-drawer"
      title={
        <Space>
          <CloudUploadOutlined />
          <span>上传任务</span>
          {uploading && <Tag color="processing">进行中</Tag>}
        </Space>
      }
      placement="right"
      width={400}
      open={open}
      onClose={onClose}
      footer={
        completedCount > 0 ? (
          <div className="flex justify-end">
            <Button icon={<ClearOutlined />} onClick={onClearCompleted}>
              清除已完成({completedCount})
            </Button>
          </div>
        ) : null
      }
    >
      {tasks.length === 0 ? (
        <Empty description="暂无上传任务" />
      ) : (
        <div className="flex flex-col gap-4">
          {tasks.map((task) => {
            const tag = STATUS_TAG_MAP[task.status];
            return (
              <div key={task.id} className="upload-task-card flex flex-col gap-2">
                {/* 第一行:文件名 + 大小 + 状态 */}
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium flex-1">
                    {task.file.name}
                  </span>
                  <Space size={4}>
                    <span className="text-xs text-gray-400">
                      {formatFileSize(task.file.size)}
                    </span>
                    <Tag color={tag.color} className="text-xs">
                      {tag.label}
                    </Tag>
                  </Space>
                </div>
                {/* 第二行:进度条(仅上传中/成功时显示) */}
                {(task.status === 'uploading' || task.status === 'success') && (
                  <Progress
                    percent={task.progress}
                    size="small"
                    status={task.status === 'success' ? 'success' : 'active'}
                    strokeColor={{ from: '#5c748c', to: '#9baebf' }}
                  />
                )}
                {/* 失败时显示错误信息 */}
                {task.status === 'error' && task.errorMessage && (
                  <span className="text-xs text-red-500">{task.errorMessage}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
};
