import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/request'
import type { Folder } from '../types'

/** 当前用户的文件夹（文档整理空间，per-user 独立） */
export const useFoldersStore = defineStore('folders', () => {
  const list = ref<Folder[]>([])
  const loading = ref(false)

  async function fetch(): Promise<void> {
    loading.value = true
    try {
      const { data } = await api.get('/folders')
      list.value = data.data
    } finally {
      loading.value = false
    }
  }

  /** 新建文件夹（重名由服务端 422 拒绝，错误交由调用方展示） */
  async function create(name: string): Promise<Folder> {
    const { data } = await api.post('/folders', { name })
    list.value.push(data.data)
    return data.data
  }

  /** 重命名（本地精确替换，documents_count 不变无需 refetch） */
  async function rename(id: number, name: string): Promise<void> {
    const { data } = await api.put(`/folders/${id}`, { name })
    const index = list.value.findIndex((folder) => folder.id === id)
    if (index !== -1) {
      list.value[index] = data.data
    }
  }

  /** 删除文件夹（归属级联消失，文档回到未分类） */
  async function remove(id: number): Promise<void> {
    await api.delete(`/folders/${id}`)
    list.value = list.value.filter((folder) => folder.id !== id)
  }

  return {
    list,
    loading,
    fetch,
    create,
    rename,
    remove,
  }
})
