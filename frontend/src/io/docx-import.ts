import mammoth from 'mammoth/mammoth.browser.min.js'
import { generateJSON } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { getBaseExtensions } from './extensions'

/**
 * .docx 文件 → Tiptap 文档 JSON
 * mammoth 转 HTML（标题/列表/表格/基础样式），再用与编辑器一致的 schema 解析。
 */
export async function docxFileToJson(file: File): Promise<JSONContent> {
  const arrayBuffer = await file.arrayBuffer()
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer })
  const json = generateJSON(html, getBaseExtensions()) as JSONContent

  if (!json.content || json.content.length === 0) {
    throw new Error('文档内容为空或格式不受支持')
  }
  return json
}
