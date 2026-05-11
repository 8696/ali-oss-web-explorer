/**
 * RenameModal
 *
 * 重命名交互弹窗:仅收集「新名称」(不含父路径),实际 OSS 逻辑由上层调用 `renameEntry`。
 *
 * 行为说明:
 * - 打开时把 `entry.name` 写入表单作为默认值,便于小幅修改;
 * - 校验规则与新建文件夹一致(必填、长度、禁止 `/` `\`),保证与 service 层 `sanitizeEntryBaseName` 预期一致;
 * - `onConfirm` 失败时应向上抛出,弹窗不关且不清空表单;错误 toast 由 App 处理;
 * - `destroyOnClose` 避免关闭后残留表单状态。
 */

import React, { useCallback, useEffect } from 'react';
import { Modal, Form, Input, Alert, Progress } from 'antd';
import { FormOutlined } from '@ant-design/icons';
import type { FileEntry, RenameDirectoryProgress } from '@/types/oss';

export interface RenameModalProps {
  /** 是否显示弹窗 */
  open: boolean;
  /** 被重命名的条目;为 null 时不应打开(调用方保证) */
  entry: FileEntry | null;
  /** 目录重命名时的复制/删除进度;单文件或未开始时为 null */
  directoryProgress?: RenameDirectoryProgress | null;
  /** 用户点击取消或关闭 */
  onCancel: () => void;
  /**
   * 用户点击确定且表单校验通过
   * @param newName 新名称(仅最后一段)
   */
  onConfirm: (newName: string) => Promise<void>;
}

export const RenameModal: React.FC<RenameModalProps> = ({
  open,
  entry,
  directoryProgress = null,
  onCancel,
  onConfirm,
}) => {
  const [form] = Form.useForm<{ newName: string }>();
  const [submitting, setSubmitting] = React.useState(false);

  /** 弹窗打开且有条目时,同步默认输入为当前名称 */
  useEffect(() => {
    if (open && entry) {
      form.setFieldsValue({ newName: entry.name });
    }
  }, [open, entry, form]);

  /** 校验通过后调用上层;loading 由 submitting 驱动 Modal 的 confirmLoading */
  const handleOk = useCallback(async () => {
    let values: { newName: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      setSubmitting(true);
      await onConfirm(values.newName);
      form.resetFields();
    } finally {
      setSubmitting(false);
    }
  }, [form, onConfirm]);

  const titleLabel = entry?.type === 'directory' ? '文件夹' : '文件';

  return (
    <Modal
      className="oss-modal"
      title={
        <span className="flex items-center gap-2">
          <FormOutlined />
          重命名{titleLabel}
        </span>
      }
      open={open}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      okText="确定"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
    >
      {entry?.type === 'directory' && (
        <Alert
          type="warning"
          showIcon
          className="mb-4"
          message="文件夹重命名说明"
          description="OSS 无原子改名:需逐个复制对象再删旧路径。中途失败可能在新旧前缀下各留一部分对象,重要数据请先备份。"
        />
      )}
      {entry?.type === 'directory' && directoryProgress && directoryProgress.total > 0 && (
        <div className="mb-4">
          <div className="mb-1 text-sm text-neutral-600">
            {directoryProgress.phase === 'copy' ? '正在复制对象到目标路径…' : '正在删除旧路径下的对象…'}
          </div>
          <Progress
            percent={Math.min(100, Math.round((100 * directoryProgress.done) / directoryProgress.total))}
            status="active"
            showInfo
            format={() => `${directoryProgress.done} / ${directoryProgress.total}`}
          />
        </div>
      )}
      <Form form={form} layout="vertical" className="mt-4">
        <Form.Item
          name="newName"
          rules={[
            { required: true, message: '请输入新名称' },
            { max: 255, message: '名称不能超过 255 个字符' },
            {
              pattern: /^[^/\\]+$/,
              message: '名称不能包含 / 或 \\',
            },
          ]}
        >
          <Input
            placeholder="请输入新名称"
            autoFocus
            maxLength={255}
            onPressEnter={handleOk}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};
