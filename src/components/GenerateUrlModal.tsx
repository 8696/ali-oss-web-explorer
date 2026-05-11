/**
 * GenerateUrlModal
 *
 * 生成临时访问链接弹窗。
 * 用户设置有效期后生成带签名的 HTTP 地址，支持一键复制。
 */

import React, { useCallback, useState } from 'react';
import { Modal, Form, InputNumber, Input, Button, App } from 'antd';
import { LinkOutlined, CopyOutlined } from '@ant-design/icons';

export interface GenerateUrlModalProps {
  open: boolean;
  fileName: string;
  onGenerate: (expiresMinutes: number) => string;
  onCancel: () => void;
}

export const GenerateUrlModal: React.FC<GenerateUrlModalProps> = ({
  open,
  fileName,
  onGenerate,
  onCancel,
}) => {
  const [form] = Form.useForm<{ expires: number }>();
  const { message } = App.useApp();
  const [generatedUrl, setGeneratedUrl] = useState<string>('');

  const handleGenerate = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const url = onGenerate(values.expires);
      setGeneratedUrl(url);
    } catch {
      // validateFields 失败时 Ant Design 会自动展示表单错误
    }
  }, [form, onGenerate]);

  const handleCopy = useCallback(async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      message.success('已复制到剪贴板');
    } catch {
      message.error('复制失败，请手动复制');
    }
  }, [generatedUrl]);

  const handleClose = useCallback(() => {
    setGeneratedUrl('');
    form.resetFields();
    onCancel();
  }, [form, onCancel]);

  return (
    <Modal
      className="oss-modal"
      title={
        <span className="flex items-center gap-2">
          <LinkOutlined />
          生成访问链接
        </span>
      }
      open={open}
      onCancel={handleClose}
      footer={null}
      destroyOnClose
    >
      <div className="mt-2 mb-3 text-sm text-muted">
        文件：<span className="text-ink">{fileName}</span>
      </div>

      <Form
        form={form}
        layout="vertical"
        initialValues={{ expires: 10 }}
      >
        <Form.Item
          name="expires"
          label="链接有效期（分钟）"
          rules={[
            { required: true, message: '请输入有效期' },
            { type: 'number', min: 1, max: 60480, message: '有效期范围 1 ~ 60480 分钟（最多 7 天）' },
          ]}
        >
          <InputNumber
            className="w-full"
            min={1}
            max={60480}
            placeholder="输入有效期（分钟）"
            onPressEnter={handleGenerate}
          />
        </Form.Item>
      </Form>

      <Button type="primary" block onClick={handleGenerate}>
        生成链接
      </Button>

      {generatedUrl && (
        <div className="mt-4">
          <div className="mb-1 text-sm text-muted">访问链接：</div>
          <Input.TextArea
            readOnly
            autoSize={{ minRows: 2, maxRows: 4 }}
            value={generatedUrl}
            className="font-mono text-xs"
          />
          <Button
            type="primary"
            className="mt-2"
            icon={<CopyOutlined />}
            onClick={handleCopy}
          >
            复制链接
          </Button>
        </div>
      )}
    </Modal>
  );
};
