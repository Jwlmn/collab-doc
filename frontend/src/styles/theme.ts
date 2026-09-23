import type { GlobalThemeOverrides } from 'naive-ui'

/**
 * 浅色主题 token（对齐现状的最小覆盖）。
 * 注意：bodyColor/textColor 必须与 index.html 内联防黑帧变量保持同值，
 * 避免 Vue 挂载前后颜色跳变；index.html 那 6 个变量不可删除。
 */
export const themeOverrides: GlobalThemeOverrides = {
  common: {
    // 与全站硬编码强调色（焦点环/未读点/高亮）统一为蓝，替换 Naive 默认绿
    primaryColor: '#2080f0',
    primaryColorHover: '#4098fc',
    primaryColorPressed: '#166ecc',
    primaryColorSuppl: '#4098fc',
    errorColor: '#d03050',
    errorColorHover: '#e37084',
    errorColorPressed: '#ab2840',
    errorColorSuppl: '#e37084',
    textColorBase: '#1f2329',
    textColor1: '#1f2329',
    textColor2: '#4e5969',
    textColor3: '#86909c',
    placeholderColor: '#a9aeb8',
    bodyColor: '#f7f8fa',
    borderColor: '#e5e6eb',
    dividerColor: '#e5e6eb',
    borderRadius: '6px',
  },
}
