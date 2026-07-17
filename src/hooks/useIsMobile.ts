/**
 * useIsMobile
 *
 * 基于 matchMedia 判断当前视口是否为移动端（< 768px，与 Tailwind `md` 断点一致）。
 * 初始值直接读取 `window.matchMedia`，避免首帧按桌面布局再闪回手机布局。
 */

import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
