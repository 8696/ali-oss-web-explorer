/**
 * ObjectAclModal
 *
 * 查看并修改单个 OSS 对象的 ACL(访问控制列表)。
 * 打开时拉取当前 ACL,用户选择后保存调用 PutObjectACL。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Form, Radio, Alert, App, Spin } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import type { FileEntry, ObjectAcl } from '@/types/oss';

const ACL_OPTIONS: { value: ObjectAcl; label: string; hint: string }[] = [
  { value: 'default', label: '默认', hint: '继承 Bucket 的 ACL 设置' },
  { value: 'private', label: '私有', hint: '仅 Bucket 拥有者与授权账号可读写' },
  { value: 'public-read', label: '公共读', hint: '任何人可通过 URL 读取对象内容' },
  {
    value: 'public-read-write',
    label: '公共读写',
    hint: '任何人可读写该对象,存在安全风险,请谨慎使用',
  },
];

export interface ObjectAclModalProps {
  open: boolean;
  /** 当前操作的文件;目录不使用本弹窗 */
  entry: FileEntry | null;
  onFetchAcl: (objectKey: string) => Promise<ObjectAcl>;
  onSaveAcl: (objectKey: string, acl: ObjectAcl) => Promise<void>;
  onCancel: () => void;
}

export const ObjectAclModal: React.FC<ObjectAclModalProps> = ({
  open,
  entry,
  onFetchAcl,
  onSaveAcl,
  onCancel,
}) => {
  const [form] = Form.useForm<{ acl: ObjectAcl }>();
  const { message } = App.useApp();
  const [loadingAcl, setLoadingAcl] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !entry || entry.type !== 'file') {
      return;
    }
    let cancelled = false;
    setLoadingAcl(true);
    form.resetFields();
    void onFetchAcl(entry.path)
      .then((acl) => {
        if (!cancelled) {
          form.setFieldsValue({ acl });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          message.error(err instanceof Error ? err.message : '获取权限失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAcl(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, entry, onFetchAcl, form, message]);

  const handleOk = useCallback(async () => {
    if (!entry || entry.type !== 'file') return;
    let values: { acl: ObjectAcl };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      setSaving(true);
      await onSaveAcl(entry.path, values.acl);
      onCancel();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存权限失败');
    } finally {
      setSaving(false);
    }
  }, [entry, form, onSaveAcl, onCancel, message]);

  const handleCancel = useCallback(() => {
    if (saving) return;
    onCancel();
  }, [onCancel, saving]);

  return (
    <Modal
      className="oss-modal"
      title={
        <span className="flex items-center gap-2">
          <SafetyCertificateOutlined />
          读写权限 (ACL)
        </span>
      }
      open={open && !!entry && entry.type === 'file'}
      onOk={() => void handleOk()}
      onCancel={handleCancel}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: loadingAcl }}
      destroyOnHidden
    >
      {entry && entry.type === 'file' && (
        <div className="mb-3 text-sm text-muted">
          文件：<span className="text-ink">{entry.name}</span>
        </div>
      )}

      <Alert
        type="info"
        showIcon
        className="mb-4"
        message="对象 ACL 与 RAM 策略、Bucket Policy 共同生效;此处仅设置对象级 ACL。"
      />

      <Spin spinning={loadingAcl}>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="acl"
            label="访问权限"
            rules={[{ required: true, message: '请选择一项' }]}
          >
            <Radio.Group className="w-full">
              <div className="flex flex-col gap-2">
                {ACL_OPTIONS.map((opt) => (
                  <Radio key={opt.value} value={opt.value} className="items-start leading-snug">
                    <span>
                      <span className="font-medium text-ink">{opt.label}</span>
                      <span className="ml-2 text-sm text-muted">{opt.hint}</span>
                    </span>
                  </Radio>
                ))}
              </div>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
};
