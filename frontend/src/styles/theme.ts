import type { GlobalThemeOverrides } from 'naive-ui'

/**
 * 浅色主题 token（对齐现状的最小覆盖）。
 * 注意：bodyColor/textColor 必须与 index.html 内联防黑帧变量保持同值，
 * 避免 Vue 挂载前后颜色跳变；index.html 那套变量不可删除。
 */
export const lightThemeOverrides: GlobalThemeOverrides = {
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
    // #86909c 在白底上只有 3.23:1，12px 文本达不到 WCAG AA 的 4.5:1，
    // 加深到 #6a707a（约 4.9:1），仍明显浅于 textColor2 以保住层级
    textColor3: '#6a707a',
    placeholderColor: '#a9aeb8',
    bodyColor: '#f6f7f9',
    borderColor: '#e5e6eb',
    dividerColor: '#e5e6eb',
    // 对齐 index.html 的 --radius-md：控件与卡片圆角统一，避免 6px/10px 混用
    borderRadius: '8px',
    borderRadiusSmall: '6px',
  },
  Card: {
    borderRadius: '12px',
    // 用自定义阴影变量，让卡片与页面阴影体系同源
    boxShadow: 'var(--shadow-card)',
    boxShadowHover: 'var(--shadow-lift)',
  },
  Button: {
    fontWeightStrong: '500',
  },
}

/**
 * 深色主题 token：与 index.html 的 [data-theme='dark'] 变量同值，
 * 强调色/圆角沿用浅色套，保证按钮、焦点环在两套主题下观感一致。
 */
export const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#2080f0',
    primaryColorHover: '#4098fc',
    primaryColorPressed: '#166ecc',
    primaryColorSuppl: '#4098fc',
    errorColor: '#e37084',
    errorColorHover: '#ec8ba0',
    errorColorPressed: '#c24a62',
    errorColorSuppl: '#ec8ba0',
    textColorBase: '#e9eaee',
    textColor1: '#e9eaee',
    textColor2: '#a9aeb8',
    textColor3: '#86909c',
    placeholderColor: '#6a707a',
    bodyColor: '#141519',
    borderColor: '#2b2e35',
    dividerColor: '#2b2e35',
    borderRadius: '8px',
    borderRadiusSmall: '6px',
  },
  Card: {
    borderRadius: '12px',
    boxShadow: 'var(--shadow-card)',
    boxShadowHover: 'var(--shadow-lift)',
  },
  Button: {
    fontWeightStrong: '500',
  },
  Layout: {
    // 对齐 index.html 的深色变量：页面 #141519、顶栏/卡片 #1c1e23，
    // 否则文档列表等未自带背景的页面会露出 naive 深色默认的 #101014 色块
    color: '#141519',
    colorEmbedded: '#141519',
    headerColor: '#1c1e23',
  },
}
