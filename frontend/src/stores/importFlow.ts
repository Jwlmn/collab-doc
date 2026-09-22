import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { JSONContent } from '@tiptap/core'
import type { CellMap } from '../io/cells'

/** 导入种子载荷：MD 文档 = Tiptap JSON；Excel 文档 = 单元格 map */
export type PendingImport =
  | { kind: 'md'; json: JSONContent }
  | { kind: 'excel'; cells: CellMap }

/**
 * 导入流程暂存：列表页导入文件 → 创建对应类型空文档 → 跳转编辑器，
 * 编辑器在协同同步完成后取出内容写入（一次性消费）。
 */
export const useImportFlowStore = defineStore('importFlow', () => {
  const pending = ref<PendingImport | null>(null)

  function setPending(payload: PendingImport): void {
    pending.value = payload
  }

  function consumePending(): PendingImport | null {
    const payload = pending.value
    pending.value = null
    return payload
  }

  return { pending, setPending, consumePending }
})
