export interface User {
  id: number
  name: string
  email: string
  created_at?: string
}

export interface LoginPayload {
  email: string
  password: string
  remember?: boolean
}

export interface RegisterPayload {
  name: string
  email: string
  password: string
  password_confirmation: string
}

export type DocumentRole = 'owner' | 'editor' | 'viewer'

export type DocumentType = 'md' | 'excel'

export interface DocumentMeta {
  id: number
  user_id: number
  title: string
  /** md = 富文本文档；excel = 电子表格文档 */
  type?: DocumentType
  role?: DocumentRole | null
  owner?: { id: number | null; name: string | null }
  /** 共享成员摘要（不含所有者本人） */
  members?: Array<{ id: number | null; name: string | null; role?: string }>
  created_at?: string
  updated_at?: string
  /** 搜索结果时返回的上下文片段 */
  snippet?: string | null
}

export interface DocumentMember {
  id: number
  document_id: number
  role: 'viewer' | 'editor'
  user: { id: number; name: string; email: string }
  created_at?: string
}

export interface CollabToken {
  token: string
  role: DocumentRole
  expires_at: number
}

export interface Comment {
  id: number
  document_id: number
  content: string
  mentions: number[]
  user: { id: number | null; name: string | null }
  created_at?: string
}

export interface MentionUser {
  id: number
  name: string
}

export interface DocumentVersion {
  id: number
  document_id: number
  name: string | null
  /** 列表接口不返回内容字段，预览/恢复时经 show 获取 */
  content_json?: Record<string, unknown>
  content_html?: string
  user: { id: number | null; name: string | null }
  created_at?: string
}
