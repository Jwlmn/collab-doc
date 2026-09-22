import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/request'
import type { DocumentMeta } from '../types'

export const useDocumentsStore = defineStore('documents', () => {
  const list = ref<DocumentMeta[]>([])
  // 初始即为加载中：首帧渲染骨架屏，避免空状态抢帧闪烁
  const loading = ref(true)
  /** 当前是否处于搜索模式 */
  const searching = ref(false)
  const activeQuery = ref('')

  async function fetch(): Promise<void> {
    loading.value = true
    activeQuery.value = ''
    searching.value = false
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
      list.value[index] = data.data
    }
  }

  async function remove(id: number): Promise<void> {
    await api.delete(`/documents/${id}`)
    list.value = list.value.filter((doc) => doc.id !== id)
  }

  return { list, loading, searching, activeQuery, fetch, search, create, rename, remove }
})
