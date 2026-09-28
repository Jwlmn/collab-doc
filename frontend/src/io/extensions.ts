import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
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
 */
export function getBaseExtensions(): Extensions {
  return [
    StarterKit.configure({
      undoRedo: false,
      link: { openOnClick: false, autolink: true },
    }),
    TableKit,
    Image.configure({ allowBase64: false, inline: true }),
  ]
}
