import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/request'
import type { CommentHit, DocumentMeta } from '../types'

export const useDocumentsStore = defineStore('documents', () => {
  const list = ref<DocumentMeta[]>([])
  // 初始即为加载中：首帧渲染骨架屏，避免空状态抢帧闪烁
  const loading = ref(true)
  /** 当前是否处于搜索模式 */
  const searching = ref(false)
  const activeQuery = ref('')
  /** 评论命中（搜索模式下才有值） */
  const commentHits = ref<CommentHit[]>([])

  async function fetch(): Promise<void> {
    loading.value = true
    activeQuery.value = ''
    searching.value = false
    commentHits.value = []
    try {
      const { data } = await api.get('/documents')
      list.value = data.data
    } finally {
      loading.value = false
    }
  }

  async function search(query: string): Promise<void> {
    const q = query.trim()
    activeQuery.value = q

    if (q === '') {
      await fetch()
      return
    }

    loading.value = true
    searching.value = true
    try {
      const { data } = await api.get('/documents/search', { params: { q } })
      list.value = data.data
      commentHits.value = (data.comment_hits ?? []) as CommentHit[]
    } finally {
      loading.value = false
    }
  }

  async function create(title?: string, type: 'md' | 'excel' = 'md'): Promise<DocumentMeta> {
    const payload: Record<string, string> = { type }
    if (title) payload.title = title
    const { data } = await api.post('/documents', payload)
    list.value.unshift(data.data)
    return data.data
  }

  async function rename(id: number, title: string): Promise<void> {
    const { data } = await api.put(`/documents/${id}`, { title })
    const index = list.value.findIndex((doc) => doc.id === id)
    if (index !== -1) {
      // 合并而非整行替换：搜索态的 snippet 不在响应里，替换会丢高亮片段
      list.value[index] = { ...list.value[index], ...data.data }
    }
  }

  async function remove(id: number): Promise<void> {
    await api.delete(`/documents/${id}`)
    list.value = list.value.filter((doc) => doc.id !== id)
  }

  /** 置顶 / 取消置顶（服务端按用户独立），返回切换后的状态 */
  async function togglePin(doc: DocumentMeta): Promise<boolean> {
    const pinned = !doc.pinned
    const { data } = await api.post(`/documents/${doc.id}/pin`, { pinned })
    const index = list.value.findIndex((item) => item.id === doc.id)
    if (index !== -1) {
      // 合并而非整行替换：搜索态的 snippet 不在响应里，替换会丢高亮片段
      list.value[index] = { ...list.value[index], ...data.data }
    }
    return pinned
  }

  /** 把文档移入/移出当前用户的文件夹（folderId=null → 未分类），返回生效的 folder_id */
  async function setFolder(doc: DocumentMeta, folderId: number | null): Promise<number | null> {
    const { data } = await api.post(`/documents/${doc.id}/folder`, { folder_id: folderId })
    const index = list.value.findIndex((item) => item.id === doc.id)
    if (index !== -1) {
      // attach 响应只有 { folder_id }（非完整 DocumentResource）→ 只能合并，绝不整行替换
      list.value[index] = { ...list.value[index], folder_id: data.data.folder_id }
    }
    return data.data.folder_id
  }

  return {
    list,
    loading,
    searching,
    activeQuery,
    commentHits,
    fetch,
    search,
    create,
    rename,
    remove,
    togglePin,
    setFolder,
  }
})
