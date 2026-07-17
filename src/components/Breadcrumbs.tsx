/**
 * Breadcrumbs
 *
 * 面包屑导航组件。
 * 从根目录到当前目录逐级展示,点击任意片段可直接跳转到对应层级。
 * 同时在右侧展示当前目录的统计信息,帮助用户快速感知目录规模。
 * 移动端路径可横向滚动,统计文案缩短以免挤占路径区域。
 */

import React from 'react';
import { Breadcrumb, Spin, Typography } from 'antd';
import { HomeOutlined, LoadingOutlined } from '@ant-design/icons';
import { splitPrefixToCrumbs } from '@/utils/format';
import { useIsMobile } from '@/hooks/useIsMobile';

export interface BreadcrumbsProps {
  /** 当前目录前缀,根目录为 '' */
  prefix: string;
  /** 当前目录下的文件夹数量 */
  folderCount: number;
  /** 当前目录下的文件数量 */
  fileCount: number;
  /** 当前目录是否正在加载 */
  loading: boolean;
  /** 点击某个面包屑片段时的回调,传入目标 prefix */
  onNavigate: (prefix: string) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  prefix,
  folderCount,
  fileCount,
  loading,
  onNavigate,
}) => {
  const isMobile = useIsMobile();
  const items = splitPrefixToCrumbs(prefix);

  const statsText = loading
    ? '加载中…'
    : isMobile
      ? `${folderCount} 文件夹 · ${fileCount} 文件`
      : `当前目录：${folderCount} 个文件夹 · ${fileCount} 个文件`;

  return (
    <div className="breadcrumbs-panel flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
      <div className="breadcrumbs-trail-scroll min-w-0 flex-1 overflow-x-auto">
        <Breadcrumb
          className="breadcrumbs-trail select-none whitespace-nowrap"
          items={items.map((item, idx) => {
            const clickable = idx < items.length - 1 && !loading;
            return {
              title:
                idx === 0 ? (
                  <span className="breadcrumbs-item flex items-center gap-1.5 text-[14px] leading-none">
                    <HomeOutlined />
                    <span>{item.label}</span>
                  </span>
                ) : (
                  <span className="breadcrumbs-item text-[14px] leading-none">{item.label}</span>
                ),
              // 最后一个是当前目录,不可点击;加载中时也禁用跳转,避免慢网下连续点击触发多次请求
              onClick: clickable ? () => onNavigate(item.prefix) : undefined,
              className: clickable ? 'cursor-pointer' : 'cursor-default text-muted',
            };
          })}
        />
      </div>

      <Typography.Text
        type="secondary"
        className="breadcrumbs-stats flex shrink-0 items-center gap-2 text-xs whitespace-nowrap md:text-sm"
      >
        {loading && <Spin size="small" indicator={<LoadingOutlined spin />} />}
        <span>{statsText}</span>
      </Typography.Text>
    </div>
  );
};
