/**
 * DeleteConfirmModal
 *
 * 危险操作二次确认弹窗,降低误触删除的风险。
 *
 * 交互约定:
 * - 用户须在输入框中**完整**输入 {@link DELETE_CONFIRM_PHRASE} 后,「删除」按钮才可点;
 * - `onConfirm` 可为异步;执行期间按钮 `loading`,防止重复提交;
 * - 若 `onConfirm` reject(例如 OSS 删除失败),弹窗保持打开,便于用户修正后重试或取消;
 * - `destroyOnClose` 保证关闭后卸载子树,下次打开输入框从空开始。
 */

import React, { useEffect, useState } from 'react';
import { Modal, Input, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';

/** 用户须输入的确认文案,与校验逻辑一致 */
export const DELETE_CONFIRM_PHRASE = '确定删除';

export interface DeleteConfirmModalProps {
  open: boolean;
  /** 说明将删除的内容(主文案) */
  title: React.ReactNode;
  /** 可选补充说明 */
  description?: React.ReactNode;
  onCancel: () => void;
  /** 删除逻辑;失败时应 reject,以便弹窗保持打开 */
  onConfirm: () => void | Promise<void>;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  open,
  title,
  description,
  onCancel,
  onConfirm,
}) => {
  /** 用户当前输入的确认短语(不去除中间空格,仅首尾 trim 后与常量比较) */
  const [input, setInput] = useState('');
  /** `onConfirm` 执行中,用于禁用重复点击与 Enter 提交 */
  const [submitting, setSubmitting] = useState(false);

  // 关闭弹窗时复位本地状态,避免下次打开仍残留上次输入或 loading 视觉
  useEffect(() => {
    if (!open) {
      setInput('');
      setSubmitting(false);
    }
  }, [open]);

  const phraseOk = input.trim() === DELETE_CONFIRM_PHRASE;

  const handleOk = async () => {
    if (!phraseOk) return;
    try {
      setSubmitting(true);
      await onConfirm();
      // 成功时通常由父组件在 onConfirm 内 setOpen(false);此处不强制关窗,保持单一职责
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      className="oss-modal"
      open={open}
      title={
        <span className="flex items-center gap-2">
          <DeleteOutlined />
          确认删除
        </span>
      }
      onCancel={onCancel}
      onOk={handleOk}
      okText="删除"
      cancelText="取消"
      okButtonProps={{ danger: true, disabled: !phraseOk, loading: submitting }}
      destroyOnClose
    >
      <div className="flex flex-col gap-3">
        <Typography.Paragraph className="!mb-0">{title}</Typography.Paragraph>
        {description}
        <div>
          <Typography.Text type="secondary" className="mb-2 block text-sm">
            请输入「{DELETE_CONFIRM_PHRASE}」以确认:
          </Typography.Text>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={DELETE_CONFIRM_PHRASE}
            autoComplete="off"
            onPressEnter={() => {
              if (phraseOk && !submitting) void handleOk();
            }}
          />
        </div>
      </div>
    </Modal>
  );
};
