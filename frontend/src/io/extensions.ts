import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import type { Extensions } from '@tiptap/core'

/**
 * 基础扩展（文档 schema 的唯一来源）：
 * - 编辑器在它之上追加协作/气泡菜单/斜杠命令
 * - 导入转换（docx/md/xlsx → JSON）用同一列表生成 schema，保证解析结果可编辑
 */
export function getBaseExtensions(): Extensions {
  return [
    StarterKit.configure({
      undoRedo: false,
      link: { openOnClick: false, autolink: true },
    }),
    TableKit,
  ]
}
