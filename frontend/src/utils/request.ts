import axios, { AxiosError } from 'axios'
import { i18n } from '../i18n'

/** 后端 API 客户端（经 Vite 代理，同源 Cookie 认证） */
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    Accept: 'application/json',
  },
})

/**
 * 会话过期（非 /user 探测）时跳转登录页。
 * /user 的 401 属于未登录的正常探测，由路由守卫静默处理。
 */
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      const url = error.config?.url ?? ''
      const path = window.location.pathname
      const isAuthProbe = url.includes('/user')
      const onAuthPage = path.startsWith('/login') || path.startsWith('/register')
      // 分享访客页无登录态：把用户踢去登录等于毁掉分享链接
      const onSharePage = path.startsWith('/share')

      if (!isAuthProbe && !onAuthPage && !onSharePage) {
        window.location.assign(`/login?redirect=${encodeURIComponent(path)}`)
      }
    }
    return Promise.reject(error)
  },
)

/** 获取 CSRF Cookie（注册/登录/登出前调用） */
export async function ensureCsrf(): Promise<void> {
  await axios.get('/sanctum/csrf-cookie', { withCredentials: true })
}

/** 提取后端返回的可读错误信息 */
export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = (error as AxiosError<{ message?: string; errors?: Record<string, string[]> }>).response
      ?.data
    if (data?.errors) {
      const first = Object.values(data.errors)[0]?.[0]
      if (first) return first
    }
    if (data?.message) return data.message
  }
  return i18n.global.t('common.requestFailed')
}
