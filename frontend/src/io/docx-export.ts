import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx'
import type { JSONContent } from '@tiptap/core'

/* ------------------------------------------------------------------ */
/*  Tiptap JSON → Docx                                                */
/* ------------------------------------------------------------------ */

const ORDERED_LIST_REFERENCE = 'collab-doc-ordered-list'

/** 图片在 docx 中的最大显示宽度（px），超出按比例缩 */
const MAX_IMAGE_WIDTH = 600

/** 已预取的图片资源（构建 docx 时按 URL 取用） */
interface ImageAsset {
  data: ArrayBuffer
  type: string
  width: number
  height: number
}

type ImageAssets = Map<string, ImageAsset>

/** 段落可渲染的子节点 */
type InlineChild = TextRun | ExternalHyperlink | ImageRun

interface InlineContext {
  /** 链接栈（标记嵌套时保留最外层链接） */
  href?: string
  /** 预取好的图片（没有则跳过图片节点） */
  images?: ImageAssets
}

/**
 * MIME → docx 可接受的图片类型（它的联合类型不含 webp）。
 * 未识别的类型一律按 png 传（docx 会自行失败，但至少类型正确）。
 */
function docxImageType(mime: string): 'jpg' | 'png' | 'gif' | 'bmp' {
  const base = mime.split(';')[0].toLowerCase()
  if (base === 'image/jpeg' || base === 'image/jpg') return 'jpg'
  if (base === 'image/gif') return 'gif'
  if (base === 'image/bmp') return 'bmp'
  return 'png'
}

/** 收集文档里所有图片 URL（去重） */
export function collectImageSrcs(doc: JSONContent): string[] {
  const srcs = new Set<string>()
  const walk = (nodes: JSONContent[] | undefined): void => {
    for (const node of nodes ?? []) {
      if (node.type === 'image') {
        const src = String(node.attrs?.src ?? '')
        if (src && !src.startsWith('data:')) srcs.add(src)
      }
      walk(node.content)
    }
  }
  walk(doc.content)
  return [...srcs]
}

/**
 * 预取图片字节与尺寸。
 * 单张失败不影响整体导出（跳过该图），保证「导出总能出文件」。
 */
export async function fetchImageAssets(urls: string[]): Promise<ImageAssets> {
  const assets: ImageAssets = new Map()

  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { credentials: 'same-origin' })
        if (!res.ok) return
        const blob = await res.blob()
        if (blob.size === 0) return

        const { width, height } = await measureImage(blob)
        const scaled = fitWithin(width, height, MAX_IMAGE_WIDTH)
        assets.set(url, {
          data: await blob.arrayBuffer(),
          type: blob.type || 'image/png',
          ...scaled,
        })
      } catch (error) {
        console.warn('[docx] 图片预取失败，跳过', url, error)
      }
    }),
  )

  return assets
}

/** 读取图片原始宽高 */
async function measureImage(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  }
  // 兜底：固定比例（createImageBitmap 在部分环境不可用）
  return { width: 400, height: 300 }
}

/** 等比缩放到 maxW 之内 */
function fitWithin(width: number, height: number, maxW: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: maxW, height: Math.round(maxW * 0.75) }
  if (width <= maxW) return { width, height }
  const ratio = maxW / width
  return { width: maxW, height: Math.max(1, Math.round(height * ratio)) }
}

function inlineChildren(nodes: JSONContent[] | undefined, ctx: InlineContext = {}): InlineChild[] {
  if (!nodes) return []
  const out: InlineChild[] = []

  for (const node of nodes) {
    if (node.type === 'image') {
      const src = String(node.attrs?.src ?? '')
      const asset = ctx.images?.get(src)
      if (!asset) {
        // 没预取到（加载失败/非法 src）→ 用 alt 文本占位，至少不丢语义
        const alt = String(node.attrs?.alt ?? '').trim()
        if (alt) out.push(new TextRun({ text: `[${alt}]`, color: '999999' }))
        continue
      }
      out.push(
        new ImageRun({
          type: docxImageType(asset.type),
          data: asset.data,
          transformation: { width: asset.width, height: asset.height },
        }),
      )
      continue
    }
    if (node.type === 'hardBreak') {
      out.push(new TextRun({ break: 1 }))
      continue
    }
    if (node.type === 'text') {
      const marks = node.marks ?? []
      const isCode = marks.some((m) => m.type === 'code')
      const linkMark = marks.find((m) => m.type === 'link')
      const href = linkMark ? String(linkMark.attrs?.href ?? '') : ctx.href

      const run = new TextRun({
        text: node.text ?? '',
        bold: marks.some((m) => m.type === 'bold') || undefined,
        italics: marks.some((m) => m.type === 'italic') || undefined,
        strike: marks.some((m) => m.type === 'strike') || undefined,
        ...(isCode
          ? { font: 'Courier New', shading: { type: ShadingType.CLEAR, fill: 'F4F5F7' } }
          : {}),
        ...(href ? { color: '0563C1', underline: {} } : {}),
      })

      if (href) {
        out.push(new ExternalHyperlink({ children: [run], link: href }))
      } else {
        out.push(run)
      }
      continue
    }
    if (node.content) {
      out.push(...inlineChildren(node.content, ctx))
    }
  }
  return out
}

function listLevel(_type: string, depth: number): number {
  return Math.min(depth, 5)
}

function blocksToDocx(
  nodes: JSONContent[],
  depth = 0,
  images?: ImageAssets,
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  const ctx: InlineContext = { images }

  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        const map: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
          1: HeadingLevel.HEADING_1,
          2: HeadingLevel.HEADING_2,
          3: HeadingLevel.HEADING_3,
          4: HeadingLevel.HEADING_4,
          5: HeadingLevel.HEADING_5,
          6: HeadingLevel.HEADING_6,
        }
        const level = Number(node.attrs?.level ?? 1)
        out.push(
          new Paragraph({
            heading: map[level] ?? HeadingLevel.HEADING_1,
            children: inlineChildren(node.content, ctx),
          }),
        )
        break
      }

      case 'paragraph':
        out.push(new Paragraph({ children: inlineChildren(node.content, ctx) }))
        break

      case 'bulletList':
        out.push(...listToDocx(node, false, depth, images))
        break

      case 'orderedList':
        out.push(...listToDocx(node, true, depth, images))
        break

      case 'codeBlock': {
        const text = (node.content ?? []).map((n) => n.text ?? '').join('')
        const lines = text.split('\n')
        for (const line of lines) {
          out.push(
            new Paragraph({
              children: [new TextRun({ text: line, font: 'Courier New' })],
              shading: { type: ShadingType.CLEAR, fill: 'F4F5F7' },
              spacing: { after: 0 },
            }),
          )
        }
        break
      }

      case 'blockquote': {
        for (const child of node.content ?? []) {
          if (child.type === 'paragraph') {
            out.push(
              new Paragraph({
                children: [
                  new TextRun({ text: plainInline(child), italics: true, color: '666666' }),
                ],
                indent: { left: 720 },
              }),
            )
          } else {
            out.push(...blocksToDocx([child], depth, images))
          }
        }
        break
      }

      case 'horizontalRule':
        out.push(
          new Paragraph({
            children: [],
            border: {
              bottom: { color: 'auto', space: 1, style: BorderStyle.SINGLE, size: 6 },
            },
          }),
        )
        break

      case 'table':
        out.push(tableToDocx(node, images))
        break

      default:
        if (node.content) out.push(...blocksToDocx(node.content, depth, images))
        break
    }
  }

  return out
}

function plainInline(node: JSONContent): string {
  return (node.content ?? [])
    .map((n) => (n.type === 'text' ? n.text ?? '' : plainInline(n)))
    .join('')
}

function listToDocx(list: JSONContent, ordered: boolean, depth: number, images?: ImageAssets): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  const ctx: InlineContext = { images }
  const items = list.content ?? []

  for (const item of items) {
    const blocks = item.content ?? []
    let first = true

    for (const block of blocks) {
      if (block.type === 'paragraph') {
        out.push(
          new Paragraph({
            children: inlineChildren(block.content, ctx),
            ...(ordered
              ? { numbering: { reference: ORDERED_LIST_REFERENCE, level: listLevel('o', depth) } }
              : { bullet: { level: listLevel('u', depth) } }),
          }),
        )
        first = false
      } else if (block.type === 'bulletList' || block.type === 'orderedList') {
        out.push(...listToDocx(block, block.type === 'orderedList', depth + 1, images))
        first = false
      } else if (first) {
        out.push(
          new Paragraph({
            children: [],
            ...(ordered
              ? { numbering: { reference: ORDERED_LIST_REFERENCE, level: listLevel('o', depth) } }
              : { bullet: { level: listLevel('u', depth) } }),
          }),
        )
        out.push(...blocksToDocx([block], depth + 1, images))
        first = false
      } else {
        out.push(...blocksToDocx([block], depth + 1, images))
      }
    }
  }

  return out
}

function tableToDocx(node: JSONContent, images?: ImageAssets): Table {
  const rows = node.content ?? []
  const ctx: InlineContext = { images }

  const docxRows = rows.map((row, rowIndex) => {
    const cells = (row.content ?? []).map((cell) => {
      const paragraphs = (cell.content ?? []).map((block) => {
        if (block.type === 'paragraph') {
          return new Paragraph({
            children: inlineChildren(block.content, ctx),
            ...(rowIndex === 0
              ? { spacing: { before: 40, after: 40 } }
              : { spacing: { before: 20, after: 20 } }),
          })
        }
        return new Paragraph({ children: [] })
      })

      return new TableCell({
        children: paragraphs.length ? paragraphs : [new Paragraph({ children: [] })],
        ...(rowIndex === 0
          ? { shading: { type: ShadingType.CLEAR, fill: 'EEF0F3' } }
          : {}),
      })
    })

    return new TableRow({ children: cells, tableHeader: rowIndex === 0 })
  })

  return new Table({ rows: docxRows })
}

/** 构建 docx Document（亦供测试使用） */
export function buildDocxDocument(doc: JSONContent, title: string, images?: ImageAssets): Document {
  return new Document({
    title,
    numbering: {
      config: [
        {
          reference: ORDERED_LIST_REFERENCE,
          levels: [0, 1, 2, 3, 4, 5].map((level) => ({
            level,
            format: 'decimal' as const,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        children: blocksToDocx(doc.content ?? [], 0, images),
      },
    ],
  })
}

/** Tiptap JSON → .docx Blob */
export async function jsonToDocxBlob(doc: JSONContent, title: string): Promise<Blob> {
  // 先取回图片字节（同步构建拿不到），再构建；单张失败自动跳过
  const images = await fetchImageAssets(collectImageSrcs(doc))
  const document = buildDocxDocument(doc, title, images)
  return Packer.toBlob(document)
}
