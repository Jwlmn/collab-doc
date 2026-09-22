import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, ensureCsrf } from '../utils/request'
import type { LoginPayload, RegisterPayload, User } from '../types'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const initialized = ref(false)

  /** 拉取当前登录用户（应用启动后首次导航时调用一次） */
  async function fetchUser(): Promise<void> {
    try {
      const { data } = await api.get('/user')
      user.value = data.data
    } catch {
      user.value = null
    } finally {
      initialized.value = true
    }
  }

  async function login(payload: LoginPayload): Promise<void> {
    await ensureCsrf()
    const { data } = await api.post('/login', payload)
    user.value = data.data
    initialized.value = true
  }

  async function register(payload: RegisterPayload): Promise<void> {
    await ensureCsrf()
    const { data } = await api.post('/register', payload)
    user.value = data.data
    initialized.value = true
  }

  async function logout(): Promise<void> {
    await ensureCsrf()
    await api.post('/logout')
    user.value = null
  }

  return { user, initialized, fetchUser, login, register, logout }
})
