import type { JSONContent } from '@tiptap/core'
import { parseMarkdown } from './markdown'
import { docxFileToJson } from './docx-import'
import { xlsxFileToCells } from './xlsx-import'
import type { CellMap } from './cells'

const SUPPORTED_EXTENSIONS = ['md', 'markdown', 'docx', 'xlsx'] as const

export interface ImportedFile {
  kind: 'md' | 'excel'
  /** md 文档载荷 */
  json?: JSONContent
  /** excel 文档载荷 */
  cells?: CellMap
}

/** 按扩展名分发导入转换（xlsx → Excel 文档；md/docx → 富文本文档） */
export async function importFileToPayload(file: File): Promise<ImportedFile> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(`不支持的文件类型「.${ext}」，仅支持 .md / .docx / .xlsx`)
  }

  if (ext === 'md' || ext === 'markdown') {
    const text = await file.text()
    return { kind: 'md', json: parseMarkdown(text) }
  }

  if (ext === 'docx') {
    return { kind: 'md', json: await docxFileToJson(file) }
  }

  return { kind: 'excel', cells: await xlsxFileToCells(file) }
}

/** 文件名 → 文档标题（去扩展名、清理、限长） */
export function docTitleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').trim()
  const cleaned = base.replace(/[/\\?%*:|"<>]/g, ' ').slice(0, 200).trim()
  return cleaned || '导入的文档'
}
