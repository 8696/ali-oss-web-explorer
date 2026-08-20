/**
 * ZipDownloadProgressModal
 *
 * 打包下载(zip)过程中的进度展示弹窗,与 {@link PasteProgressModal} 类似只做 UI,
 * 进度数据由 App 在调用 `buildZipFromEntries` 时通过回调累积。
 *
 * 行为约定:
 * - `open` 由上层在发起打包前置 true,zip 生成并触发浏览器保存后再置 false(不可手动关闭)。
 * - `progress` 为 null 时仅渲染空壳。
 */

import React from 'react';
import { Modal, Progress } from 'antd';
import type { ZipDownloadProgress } from '@/types/oss';

export interface ZipDownloadProgressModalProps {
  open: boolean;
  progress: ZipDownloadProgress | null;
}

const PHASE_LABEL: Record<ZipDownloadProgress['phase'], string> = {
  listing: '正在列举文件',
  downloading: '正在下载文件内容',
  packing: '正在生成 zip 文件',
};

export const ZipDownloadProgressModal: React.FC<ZipDownloadProgressModalProps> = ({ open, progress }) => {
  return (
    <Modal
      className="oss-modal"
      title="正在打包下载"
      open={open}
      footer={null}
      closable={false}
      maskClosable={false}
      destroyOnClose={false}
    >
      {progress ? (
        <>
          <div className="mb-3 text-sm text-ink">
            {PHASE_LABEL[progress.phase]}
            {progress.phase === 'downloading' && progress.currentName ? `：${progress.currentName}` : '…'}
          </div>
          {progress.total > 0 ? (
            <Progress
              percent={Math.min(100, Math.round((100 * progress.done) / progress.total))}
              format={() => `${progress.done} / ${progress.total}`}
            />
          ) : null}
          {progress.phase === 'packing' && (
            <div className="mt-2 text-xs text-muted">文件较多或较大时生成 zip 可能需要一些时间，请耐心等待。</div>
          )}
        </>
      ) : null}
    </Modal>
  );
};
