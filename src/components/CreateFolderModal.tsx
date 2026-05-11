/**
 * CreateFolderModal
 *
 * 新建文件夹弹窗。
 * 用户输入文件夹名称后点击确认,触发上层在 OSS 中创建目录。
 * 输入框会自动过滤非法字符(如 / \),防止用户误操作。
 */

import React, { useCallback } from 'react';
import { Modal, Form, Input } from 'antd';
import { FolderAddOutlined } from '@ant-design/icons';

export interface CreateFolderModalProps {
  /** 弹窗是否可见 */
  open: boolean;
  /** 关闭弹窗 */
  onCancel: () => void;
  /** 确认创建,传入文件夹名称 */
  onConfirm: (name: string) => Promise<void>;
}

export const CreateFolderModal: React.FC<CreateFolderModalProps> = ({
  open,
  onCancel,
  onConfirm,
}) => {
  const [form] = Form.useForm<{ folderName: string }>();
  const [submitting, setSubmitting] = React.useState(false);

  /**
   * 提交:调用上层创建目录,成功后关闭并重置表单
   */
  const handleOk = useCallback(async () => {
    let values: { folderName: string };
    try {
      values = await form.validateFields();
    } catch {
      // validateFields 失败时 Ant Design 会自动展示表单错误
      return;
    }
    try {
      setSubmitting(true);
      await onConfirm(values.folderName);
      form.resetFields();
    } catch (err) {
      // OSS 操作错误向上抛出，由调用方的 catch 统一处理
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [form, onConfirm]);

  return (
    <Modal
      className="oss-modal"
      title={
        <span className="flex items-center gap-2">
          <FolderAddOutlined />
          新建文件夹
        </span>
      }
      open={open}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      okText="创建"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnClose
    >
      <Form form={form} layout="vertical" className="mt-4">
        <Form.Item
          name="folderName"
          rules={[
            { required: true, message: '请输入文件夹名称' },
            { max: 255, message: '名称不能超过 255 个字符' },
            {
              // 禁止包含 / 和 \
              pattern: /^[^/\\]+$/,
              message: '名称不能包含 / 或 \\',
            },
          ]}
        >
          <Input
            placeholder="请输入文件夹名称"
            autoFocus
            maxLength={255}
            onPressEnter={handleOk}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};
