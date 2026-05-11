/**
 * 文件图标解析工具
 * 根据文件类型映射到 Ant Design 提供的图标组件,
 * 与表格组件解耦,便于后续替换图标库或自定义图标。
 */

import {
  FolderOutlined,
  FileImageOutlined,
  FileTextOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  FileZipOutlined,
  FileMarkdownOutlined,
  PlayCircleOutlined,
  SoundOutlined,
  CodeOutlined,
  FileOutlined,
} from '@ant-design/icons';
import type { ComponentType } from 'react';
import { guessFileCategory } from '@/utils/format';

/**
 * 单个图标的描述
 * Component:Ant Design Icon 组件
 * color:颜色(适配简约设计,采用低饱和色)
 */
interface IconDescriptor {
  Component: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}

/**
 * 根据文件名或目录标识获取对应的图标组件与颜色
 *
 * @param name      文件名(或目录显示名)
 * @param isFolder  是否为目录;为 true 时直接返回文件夹图标
 */
export function resolveFileIcon(name: string, isFolder: boolean): IconDescriptor {
  if (isFolder) {
    return { Component: FolderOutlined, color: '#b38757' };
  }
  const category = guessFileCategory(name);
  switch (category) {
    case 'image':
      return { Component: FileImageOutlined, color: '#6f927c' };
    case 'video':
      return { Component: PlayCircleOutlined, color: '#8a7aa6' };
    case 'audio':
      return { Component: SoundOutlined, color: '#846f96' };
    case 'pdf':
      return { Component: FilePdfOutlined, color: '#b06358' };
    case 'word':
      return { Component: FileWordOutlined, color: '#5c748c' };
    case 'excel':
      return { Component: FileExcelOutlined, color: '#6d8d78' };
    case 'ppt':
      return { Component: FilePptOutlined, color: '#bf845f' };
    case 'archive':
      return { Component: FileZipOutlined, color: '#8a8278' };
    case 'text':
      // Markdown 同样归到 text 分类,这里再细分一次
      return name.toLowerCase().endsWith('.md')
        ? { Component: FileMarkdownOutlined, color: '#6a655e' }
        : { Component: FileTextOutlined, color: '#6a655e' };
    case 'code':
      return { Component: CodeOutlined, color: '#5c748c' };
    default:
      return { Component: FileOutlined, color: '#8a8278' };
  }
}
