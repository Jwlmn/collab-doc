import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../utils/request'

export interface NotificationItem {
  id: string
  type: string
  data: {
    kind: 'mention' | 'shared'
    document_id: number
    doc_type?: string
    document_title?: string
    comment_id?: number
    actor_id?: number
    actor_name?: string
    role?: string
  }
  read_at: string | null
  created_at?: string
}

export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref<NotificationItem[]>([])
  const unread = ref(0)
  const loaded = ref(false)

  async function fetch(): Promise<void> {
    const { data } = await api.get('/notifications')
    items.value = data.data
    unread.value = data.unread
    loaded.value = true
  }

  async function markRead(id: string): Promise<void> {
    const { data } = await api.post(`/notifications/${id}/read`)
    unread.value = data.data.unread
    const item = items.value.find((n) => n.id === id)
    if (item) item.read_at = new Date().toISOString()
  }

  async function markAllRead(): Promise<void> {
    const { data } = await api.post('/notifications/read-all')
    unread.value = data.data.unread
    const now = new Date().toISOString()
    items.value.forEach((n) => {
      if (!n.read_at) n.read_at = now
    })
  }

  return { items, unread, loaded, fetch, markRead, markAllRead }
})
