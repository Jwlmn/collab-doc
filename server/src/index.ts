import { Server } from '@hocuspocus/server'
import { Redis } from '@hocuspocus/extension-redis'
import { Database } from '@hocuspocus/extension-database'
import { createHmac } from 'node:crypto'
import * as Y from 'yjs'
import pg from 'pg'

const PORT = Number(process.env.COLLAB_PORT ?? 1234)
const REDIS_HOST = process.env.REDIS_HOST ?? '127.0.0.1'
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379)
const COLLAB_SECRET = process.env.COLLAB_SECRET ?? 'collab-doc-dev-secret'

interface CollabClaims {
  document: string
  uid: number
  role: string
  exp: number
}

/** 校验 Laravel 签发的协作令牌（base64url(payload).base64url(hmac)） */
function verifyCollabToken(token: string, documentName: string): CollabClaims | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [payload, signature] = parts
  const expected = createHmac('sha256', COLLAB_SECRET)
    .update(payload)
    .digest('base64url')

  if (signature.length !== expected.length) return null

  // 定长字符串比较，避免时序侧信道
  let mismatch = 0
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  if (mismatch !== 0) return null

  let claims: CollabClaims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  if (claims.document !== documentName) return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null
  if (claims.role !== 'owner' && claims.role !== 'editor' && claims.role !== 'viewer') {
    return null
  }

  return claims
}

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_DATABASE ?? 'collab_doc',
  user: process.env.DB_USERNAME ?? 'collab',
  password: process.env.DB_PASSWORD ?? 'secret',
})

/** 递归抽取 Tiptap/Y.js XmlFragment 的纯文本（块级节点间以换行分隔） */
function extractText(root: Y.XmlFragment): string {
  const parts: string[] = []

  const visit = (node: Y.XmlFragment | Y.XmlElement | Y.XmlText): void => {
    if (node instanceof Y.XmlText) {
      parts.push(node.toString())
      return
    }
    for (const child of node.toArray() as Array<Y.XmlElement | Y.XmlText>) {
      visit(child)
    }
    if (node instanceof Y.XmlElement) {
      parts.push('\n')
    }
  }

  visit(root)
  return parts.join('').replace(/\n{2,}/g, '\n').trim()
}

const server = Server.configure({
  port: PORT,
  name: 'collab-doc-server',
  // 配置 onAuthenticate 后服务器自动要求所有连接完成认证
  async onAuthenticate({ token, documentName, connection }) {
    const claims = verifyCollabToken(token ?? '', documentName)

    if (!claims) {
      console.warn(`[collab] auth rejected: ${documentName}`)
      throw new Error('Invalid or expired collab token')
    }

    // viewer 只读：服务端拒绝其写入的 Y.js 更新
    connection.readOnly = claims.role === 'viewer'

    console.log(
      `[collab] auth ok: ${documentName} user=${claims.uid} role=${claims.role}` +
        (claims.role === 'viewer' ? ' (read-only)' : ''),
    )
  },
  extensions: [
    // 多实例消息广播
    new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
    }),
    // Y.js 文档持久化到 PostgreSQL
    new Database({
      fetch: async ({ documentName }) => {
        const res = await pool.query(
          'SELECT state FROM document_states WHERE name = $1',
          [documentName],
        )
        return res.rows[0]?.state ?? null
      },
      store: async ({ documentName, state }) => {
        await pool.query(
          `INSERT INTO document_states (name, state, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (name) DO UPDATE SET state = $2, updated_at = now()`,
          [documentName, Buffer.from(state)],
        )
      },
    }),
  ],
  async onConnect({ documentName }) {
    console.log(`[collab] connect: ${documentName}`)
  },
  // 文档内容落库时同步抽取纯文本，供 Laravel 全文检索；同时刷新 updated_at
  async onStoreDocument({ documentName, document }) {
    const match = /^doc-(\d+)$/.exec(documentName)
    if (!match) return

    const text = extractText(document.getXmlFragment('default'))
    try {
      await pool.query(
        'UPDATE documents SET search_text = $1, updated_at = now() WHERE id = $2',
        [text, match[1]],
      )
    } catch (err) {
      console.error(`[collab] search_text update failed: ${documentName}`, err)
    }
  },
})

// 文档持久化表（启动时确保存在）
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS document_states (
      name       TEXT PRIMARY KEY,
      state      BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

ensureSchema()
  .then(() => server.listen())
  .then(() => console.log(`[collab] HocusPocus listening on :${PORT}`))
  .catch((err) => {
    console.error('[collab] failed to start:', err)
    process.exit(1)
  })
