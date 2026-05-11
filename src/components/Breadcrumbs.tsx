/**
 * Breadcrumbs
 *
 * 面包屑导航组件。
 * 从根目录到当前目录逐级展示,点击任意片段可直接跳转到对应层级。
 * 同时在右侧展示当前目录的统计信息,帮助用户快速感知目录规模。
 */

import React from 'react';
import { Breadcrumb, Spin, Typography } from 'antd';
import { HomeOutlined, LoadingOutlined } from '@ant-design/icons';
import { splitPrefixToCrumbs } from '@/utils/format';

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
  const items = splitPrefixToCrumbs(prefix);

  return (
    <div className="breadcrumbs-panel flex items-center justify-between gap-3 flex-wrap">
      <Breadcrumb
        className="breadcrumbs-trail select-none"
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

      <Typography.Text type="secondary" className="breadcrumbs-stats text-sm whitespace-nowrap flex items-center gap-2">
        {loading && <Spin size="small" indicator={<LoadingOutlined spin />} />}
        <span>
          {loading
            ? '正在加载当前目录...'
            : `当前目录：${folderCount} 个文件夹 · ${fileCount} 个文件`}
        </span>
      </Typography.Text>
    </div>
  );
};

