/**
 * 应用入口
 * 引入全局样式并挂载 React 根节点
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './index.css';

/** 与 antd 的 zh_CN 语言包配套，避免 DatePicker 等组件的月份/星期回退成英文 */
dayjs.locale('zh-cn');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
