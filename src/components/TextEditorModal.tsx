/**
 * TextEditorModal
 *
 * 在线编辑文本类 OSS 对象:打开时拉取内容,保存时覆盖写回。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Input, App, Spin } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import type { FileEntry } from '@/types/oss';
import { formatFileSize } from '@/utils/format';
import { useIsMobile } from '@/hooks/useIsMobile';

export interface TextEditorModalProps {
  open: boolean;
  entry: FileEntry | null;
  onFetchContent: (objectKey: string) => Promise<string>;
  onSaveContent: (objectKey: string, content: string) => Promise<void>;
  onCancel: () => void;
}

export const TextEditorModal: React.FC<TextEditorModalProps> = ({
  open,
  entry,
  onFetchContent,
  onSaveContent,
  onCancel,
}) => {
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !entry || entry.type !== 'file') {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setContent('');
    void onFetchContent(entry.path)
      .then((text) => {
        if (!cancelled) {
          setContent(text);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          message.error(err instanceof Error ? err.message : '读取文件失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, entry, onFetchContent, message]);

  const handleOk = useCallback(async () => {
    if (!entry || entry.type !== 'file') return;
    try {
      setSaving(true);
      await onSaveContent(entry.path, content);
      onCancel();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [entry, content, onSaveContent, onCancel, message]);

  const handleCancel = useCallback(() => {
    if (saving) return;
    onCancel();
  }, [onCancel, saving]);

  return (
    <Modal
      className="oss-modal text-editor-modal"
      title={
        <span className="flex items-center gap-2">
          <EditOutlined />
          编辑文件
        </span>
      }
      open={open && !!entry && entry.type === 'file'}
      onOk={() => void handleOk()}
      onCancel={handleCancel}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: loading }}
      width={isMobile ? 'calc(100vw - 24px)' : 800}
      style={isMobile ? { top: 12, maxWidth: 'calc(100vw - 24px)' } : undefined}
      destroyOnHidden
    >
      {entry && entry.type === 'file' && (
        <div className="mb-3 flex flex-col gap-1 text-sm text-muted md:flex-row md:gap-0">
          <span>
            文件：<span className="break-all text-ink">{entry.name}</span>
          </span>
          <span className="md:ml-3">大小：{formatFileSize(entry.size)}</span>
        </div>
      )}

      <Spin spinning={loading}>
        <Input.TextArea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          autoSize={{ minRows: isMobile ? 12 : 16, maxRows: isMobile ? 18 : 24 }}
          className="font-mono text-sm"
          placeholder={loading ? '正在加载...' : '文件内容'}
          disabled={loading}
        />
      </Spin>
    </Modal>
  );
};
