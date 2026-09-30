import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { MentionMark } from '../extensions/mention'
import type { Extensions } from '@tiptap/core'

/**
 * 基础扩展（文档 schema 的唯一来源）：
 * - 编辑器在它之上追加协作/气泡菜单/斜杠命令
 * - 导入转换（docx/md/xlsx → JSON）用同一列表生成 schema，保证解析结果可编辑
 *
 * Image 关掉 allowBase64：base64 图会把 Y.js 状态和每个版本的 content_html
 * 撑爆，且对全文搜索毫无意义 —— 只接受服务端 URL。
 *
 * 用行内节点而非块级：`![alt](src)` 是 Markdown 的行内语法，行内才能与文字
 * 混排并严格往返；单独成段时它自己占一行，视觉上与块级无异。
 *
 * 富文本增强（v4 #3）：
 * - Highlight multicolor：高亮标记（默认黄，可传色）
 * - TextStyle + Color：行内文字颜色的载体与插件
 * - TextAlign：段落/标题对齐（不含 justify，工具栏只提供左/中/右）
 * 注意：这三者在 .md 导出中会降级丢失（Markdown 无对应语法，与文字颜色、
 * 对齐同边界）；.docx 导出已适配。
 */
export function getBaseExtensions(): Extensions {
  return [
    StarterKit.configure({
      undoRedo: false,
      link: { openOnClick: false, autolink: true },
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
    // @提及标记：进 schema 保证导入/协作/历史一致；`@` 建议插件由编辑器视图按需注册
    MentionMark,
    TableKit,
    Image.configure({ allowBase64: false, inline: true }),
  ]
}
