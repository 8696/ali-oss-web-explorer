/**
 * ConfigDrawer
 *
 * OSS 连接配置抽屉面板,从右侧滑入。
 * 用户在这里填写 AccessKey、Bucket、Region 等参数,点击"连接"后生效。
 * 已连接时显示当前配置摘要,并提供"断开连接"按钮。
 */

import React, { useCallback, useEffect } from 'react';
import {
  Button,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Typography,
  Alert,
} from 'antd';
import {
  DisconnectOutlined,
  LinkOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { OSSConfig } from '@/types/oss';
import { OSS_REGIONS } from '@/constants/regions';

export interface ConfigDrawerProps {
  /** 抽屉是否可见 */
  open: boolean;
  /** 关闭抽屉 */
  onClose: () => void;
  /** 当前配置(已连接时有值) */
  config: OSSConfig | null;
  /** 是否正在验证连接 */
  connecting: boolean;
  /** 连接错误信息 */
  connectError: string | null;
  /** 是否已连接 */
  connected: boolean;
  /** 保存并连接 */
  onConnect: (config: OSSConfig) => void;
  /** 断开连接 */
  onDisconnect: () => void;
}

/**
 * 表单字段定义,与 OSSConfig 接口一一对应
 */
interface ConfigFormValues {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
}

export const ConfigDrawer: React.FC<ConfigDrawerProps> = ({
  open,
  onClose,
  config,
  connecting,
  connectError,
  connected,
  onConnect,
  onDisconnect,
}) => {
  const [form] = Form.useForm<ConfigFormValues>();

  // 当已有配置(比如从 localStorage 恢复)时,填充到表单中
  useEffect(() => {
    if (open && config) {
      form.setFieldsValue({
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        bucket: config.bucket,
        region: config.region,
      });
    }
  }, [open, config, form]);

  // 每次关闭时清空表单验证错误
  useEffect(() => {
    if (!open) form.resetFields();
  }, [open, form]);

  /**
   * 提交表单:将表单值转成 OSSConfig 交给上层处理
   */
  const handleSubmit = useCallback(
    async (values: ConfigFormValues) => {
      onConnect({
        accessKeyId: values.accessKeyId,
        accessKeySecret: values.accessKeySecret,
        bucket: values.bucket,
        region: values.region,
        secure: true,
      });
    },
    [onConnect],
  );

  /**
   * 断开连接后关闭抽屉
   */
  const handleDisconnect = useCallback(() => {
    onDisconnect();
    form.resetFields();
    onClose();
  }, [onDisconnect, form, onClose]);

  return (
    <Drawer
      className="oss-drawer"
      title={
        <Space>
          <SettingOutlined />
          <span>OSS 连接配置</span>
        </Space>
      }
      placement="right"
      width={420}
      open={open}
      onClose={onClose}
      // 已连接时在底部显示"断开"按钮
      footer={
        connected ? (
          <div className="flex justify-end">
            <Button danger icon={<DisconnectOutlined />} onClick={handleDisconnect}>
              断开连接
            </Button>
          </div>
        ) : null
      }
    >
      {/* 已连接状态提示 */}
      {connected && config && (
        <Alert
          className="mb-4"
          type="success"
          showIcon
          message={`已连接到 ${config.bucket}`}
          description={`Region: ${config.region}`}
        />
      )}

      {/* 连接错误提示 */}
      {connectError && (
        <Alert
          className="mb-4"
          type="error"
          showIcon
          message="连接失败"
          description={connectError}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        requiredMark
        onFinish={handleSubmit}
        disabled={connecting}
      >
        <Form.Item
          label="AccessKey ID"
          name="accessKeyId"
          rules={[{ required: true, message: '请输入 AccessKey ID' }]}
        >
          <Input placeholder="LTAI5t..." autoComplete="off" />
        </Form.Item>

        <Form.Item
          label="AccessKey Secret"
          name="accessKeySecret"
          rules={[{ required: true, message: '请输入 AccessKey Secret' }]}
        >
          <Input.Password placeholder="请输入 AccessKey Secret" autoComplete="off" />
        </Form.Item>

        <Form.Item
          label="Bucket 名称"
          name="bucket"
          rules={[{ required: true, message: '请输入 Bucket 名称' }]}
        >
          <Input placeholder="my-bucket" autoComplete="off" />
        </Form.Item>

        <Form.Item
          label="Region 地域"
          name="region"
          rules={[{ required: true, message: '请选择 Region' }]}
        >
          <Select
            showSearch
            placeholder="选择或搜索地域"
            optionFilterProp="label"
            options={OSS_REGIONS}
            // 允许用户输入自定义 region(某些内网 endpoint)
            filterOption={(input, option) =>
              (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ??
              (option?.value as string)?.toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>

        <Form.Item className="mb-0">
          <Space className="w-full justify-end">
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              htmlType="submit"
              icon={<LinkOutlined />}
              loading={connecting}
            >
              {connecting ? '连接中...' : connected ? '重新连接' : '连接'}
            </Button>
          </Space>
        </Form.Item>
      </Form>

      {/* 安全提示 */}
      <Typography.Text
        className="mt-6 block"
        type="secondary"
        style={{ fontSize: 12 }}
      >
        提示:AccessKey 将保存在浏览器本地存储中。生产环境建议使用 STS 临时凭证。
      </Typography.Text>
      <Typography.Text
        className="mt-2 block"
        type="secondary"
        style={{ fontSize: 12 }}
      >
        若需在浏览器中上传大文件,请先在 Bucket 的 CORS 中暴露 Expose-Headers: ETag。
      </Typography.Text>
    </Drawer>
  );
};
