import readXlsxFile from 'read-excel-file/browser'
import { rowsToCells } from './cells'

/**
 * .xlsx 文件 → Excel 文档单元格 map（取第一个工作表）。
 * 公式读取为缓存结果值；合并单元格/样式不保留。
 *
 * read-excel-file v9 的默认导出返回 `Sheet[]`（{sheet, data}），
 * 行数据在 `data` 字段。
 */
export async function xlsxFileToCells(file: File): Promise<Record<string, string>> {
  const sheets = await readXlsxFile(file)

  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error('表格为空或不包含可导入的数据')
  }

  const firstSheet = sheets[0]
  const rows = firstSheet?.data ?? []

  const nonEmpty = rows.filter((row) =>
    Array.isArray(row) ? row.some((cell) => cell !== null && cell !== '') : false,
  )

  if (nonEmpty.length === 0) {
    throw new Error('表格为空或不包含可导入的数据')
  }

  const normalized = nonEmpty.map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))),
  )

  return rowsToCells(normalized)
}
