/**
 * UploadDrawer
 *
 * 上传任务面板(右侧抽屉)。
 * 按进行中 / 已完成 / 失败分 Tab 展示，支持清除非进行中的记录。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer, Button, Space, Progress, Tabs, Empty } from 'antd';
import {
  CloudUploadOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import type { UploadTask } from '@/types/oss';
import { formatFileSize } from '@/utils/format';
import { useIsMobile } from '@/hooks/useIsMobile';

type UploadTab = 'active' | 'done' | 'failed';

const STATUS_LABEL: Record<UploadTask['status'], string> = {
  waiting: '等待',
  uploading: '上传中',
  success: '完成',
  error: '失败',
};

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

function UploadTaskRow({ task }: { task: UploadTask }) {
  const showProgress = task.status === 'uploading' || task.status === 'success';

  return (
    <div className="upload-drawer-task-row flex flex-col gap-1.5 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-sm text-stone-800">{task.file.name}</span>
        <span className="shrink-0 text-xs text-stone-400 tabular-nums">
          {formatFileSize(task.file.size)}
        </span>
      </div>
      {task.status === 'waiting' || task.status === 'uploading' ? (
        <span className="text-xs text-stone-500">{STATUS_LABEL[task.status]}</span>
      ) : null}
      {showProgress && (
        <Progress
          percent={task.progress}
          size="small"
          showInfo={task.status === 'uploading'}
          status={task.status === 'success' ? 'success' : 'active'}
        />
      )}
      {task.status === 'error' && task.errorMessage ? (
        <p className="m-0 text-xs text-red-600 leading-snug">{task.errorMessage}</p>
      ) : null}
    </div>
  );
}

export const UploadDrawer: React.FC<UploadDrawerProps> = ({
  open,
  onClose,
  tasks,
  uploading,
  onClearCompleted,
}) => {
  const isMobile = useIsMobile();
  const { active, done, failed } = useMemo(() => {
    const active = tasks.filter((t) => t.status === 'waiting' || t.status === 'uploading');
    const done = tasks.filter((t) => t.status === 'success');
    const failed = tasks.filter((t) => t.status === 'error');
    return { active, done, failed };
  }, [tasks]);

  const completedCount = done.length + failed.length;
  const prevOpen = useRef(false);
  const [tab, setTab] = useState<UploadTab>('active');

  useEffect(() => {
    if (open && !prevOpen.current) {
      if (active.length) setTab('active');
      else if (failed.length) setTab('failed');
      else if (done.length) setTab('done');
      else setTab('active');
    }
    prevOpen.current = open;
  }, [open, active.length, done.length, failed.length]);

  const tabItems = useMemo(
    () => [
      {
        key: 'active' as const,
        label: `进行中 (${active.length})`,
        children:
          active.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无进行中的任务" />
          ) : (
            <div className="flex flex-col divide-y divide-stone-100">
              {active.map((task) => (
                <UploadTaskRow key={task.id} task={task} />
              ))}
            </div>
          ),
      },
      {
        key: 'done' as const,
        label: `已完成 (${done.length})`,
        children:
          done.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无已完成" />
          ) : (
            <div className="flex flex-col divide-y divide-stone-100">
              {done.map((task) => (
                <UploadTaskRow key={task.id} task={task} />
              ))}
            </div>
          ),
      },
      {
        key: 'failed' as const,
        label: `失败 (${failed.length})`,
        children:
          failed.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无失败记录" />
          ) : (
            <div className="flex flex-col divide-y divide-stone-100">
              {failed.map((task) => (
                <UploadTaskRow key={task.id} task={task} />
              ))}
            </div>
          ),
      },
    ],
    [active, done, failed],
  );

  return (
    <Drawer
      className="upload-drawer"
      title={
        <Space size={8}>
          <CloudUploadOutlined />
          <span>上传任务</span>
          {uploading ? <span className="text-xs font-normal text-stone-400">传输中…</span> : null}
        </Space>
      }
      placement="right"
      width={isMobile ? '100%' : 380}
      open={open}
      onClose={onClose}
      footer={
        completedCount > 0 ? (
          <div className="flex justify-end">
            <Button icon={<ClearOutlined />} onClick={onClearCompleted}>
              清除已完成 ({completedCount})
            </Button>
          </div>
        ) : null
      }
    >
      {tasks.length === 0 ? (
        <Empty description="暂无上传任务" />
      ) : (
        <Tabs
          size="small"
          activeKey={tab}
          onChange={(k) => setTab(k as UploadTab)}
          items={tabItems}
          className="upload-drawer-tabs mt-1"
        />
      )}
    </Drawer>
  );
};
