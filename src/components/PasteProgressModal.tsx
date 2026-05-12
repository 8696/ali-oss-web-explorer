/**
 * PasteProgressModal
 *
 * 粘贴 / 剪切移动 OSS 对象时的进度展示弹窗，与 {@link RenameModal} 一样只做 UI，
 * 进度数据由 App 在调用 `pasteClipboard` 时通过回调累积。
 *
 * 行为约定：
 * - `open` 由上层在发起粘贴前置 true，整段 OSS 流程结束后再置 false（不可手动关闭，防止误操作中断）。
 * - `progress` 为 null 时仅渲染空壳（正常不应长时间出现；首帧可由 {@link buildInitialPasteProgress} 填充）。
 * - 目录项在同一条目内会先后经历「复制整树」与「删除源前缀」两阶段，`phase` 用于区分文案与进度条含义。
 */

import React from 'react';
import { Modal, Progress } from 'antd';
import type { FileClipboardState, PasteProgress } from '@/types/oss';

export interface PasteProgressModalProps {
  open: boolean;
  /** 当前进度；为 null 时弹窗应处于关闭或仅占位 */
  progress: PasteProgress | null;
}

/**
 * 粘贴弹窗打开瞬间的占位进度，避免首帧空白或与进度条切换造成闪烁。
 * - `total` 先设为 1：后续真实进度到达后会覆盖；`entryTotal` 反映剪贴板内条目数量。
 */
export function buildInitialPasteProgress(c: FileClipboardState): PasteProgress {
  const first = c.entries[0];
  return {
    operation: c.operation,
    entryIndex: 1,
    entryTotal: Math.max(1, c.entries.length),
    entryName: first?.name ?? '…',
    entryType: first?.type ?? 'file',
    phase: 'copy',
    done: 0,
    total: 1,
  };
}

export const PasteProgressModal: React.FC<PasteProgressModalProps> = ({ open, progress }) => {
  /** 剪切移动与「仅复制」在文案上区分，底层均为 copy ± delete */
  const title = progress?.operation === 'cut' ? '正在移动' : '正在粘贴';

  return (
    <Modal
      className="oss-modal"
      title={title}
      open={open}
      footer={null}
      /** 粘贴可能耗时较长，禁止点击遮罩关闭，避免用户误以为已完成 */
      closable={false}
      maskClosable={false}
      /** 关闭后不销毁，减少重复打开时的布局抖动（进度 state 仍由 App 清空） */
      destroyOnClose={false}
    >
      {progress ? (
        <>
          <div className="mb-2 text-sm text-muted">
            {progress.entryType === 'directory' ? '文件夹' : '文件'}「{progress.entryName}」 · 第{' '}
            {progress.entryIndex} / {progress.entryTotal} 项
          </div>
          <div className="mb-3 text-sm text-ink">
            {progress.phase === 'copy' ? '正在复制对象到目标路径…' : '正在删除源路径下的对象…'}
          </div>
          {progress.total > 0 ? (
            <Progress
              percent={Math.min(100, Math.round((100 * progress.done) / progress.total))}
              /** 百分比旁展示「已完成 / 当前阶段总数」，便于观察长时间目录任务 */
              format={() => `${progress.done} / ${progress.total}`}
            />
          ) : null}
        </>
      ) : null}
    </Modal>
  );
};
