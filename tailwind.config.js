/** @type {import('tailwindcss').Config} */
export default {
  // 仅扫描 src 下的源码,避免无关文件影响产物大小
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // 避免 Tailwind 默认 preflight 与 Ant Design 自带的样式重置冲突
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // 暖白纸感主题色板(再调浅版:几乎接近纯白,只留极淡奶色与极浅边线)
        primary: '#5c748c',
        paper: '#fffefb',
        canvas: '#fdfaf5',
        line: '#f5efe5',
        ink: '#4f463c',
        muted: '#a8a094',
        hover: '#faf5ed',
      },
      fontFamily: {
        sans: [
          'Inter',
          'SF Pro Display',
          'SF Pro Text',
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        paper: '0 12px 30px rgba(49, 42, 36, 0.06)',
        float: '0 18px 40px rgba(49, 42, 36, 0.10)',
      },
    },
  },
  plugins: [],
};

