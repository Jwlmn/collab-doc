import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
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

interface InlineContext {
  /** 链接栈（标记嵌套时保留最外层链接） */
  href?: string
}

function inlineChildren(nodes: JSONContent[] | undefined, ctx: InlineContext = {}): (TextRun | ExternalHyperlink)[] {
  if (!nodes) return []
  const out: (TextRun | ExternalHyperlink)[] = []

  for (const node of nodes) {
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
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []

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
            children: inlineChildren(node.content),
          }),
        )
        break
      }

      case 'paragraph':
        out.push(new Paragraph({ children: inlineChildren(node.content) }))
        break

      case 'bulletList':
        out.push(...listToDocx(node, false, depth))
        break

      case 'orderedList':
        out.push(...listToDocx(node, true, depth))
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
            out.push(...blocksToDocx([child], depth))
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
        out.push(tableToDocx(node))
        break

      default:
        if (node.content) out.push(...blocksToDocx(node.content, depth))
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

function listToDocx(list: JSONContent, ordered: boolean, depth: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  const items = list.content ?? []

  for (const item of items) {
    const blocks = item.content ?? []
    let first = true

    for (const block of blocks) {
      if (block.type === 'paragraph') {
        out.push(
          new Paragraph({
            children: inlineChildren(block.content),
            ...(ordered
              ? { numbering: { reference: ORDERED_LIST_REFERENCE, level: listLevel('o', depth) } }
              : { bullet: { level: listLevel('u', depth) } }),
          }),
        )
        first = false
      } else if (block.type === 'bulletList' || block.type === 'orderedList') {
        out.push(...listToDocx(block, block.type === 'orderedList', depth + 1))
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
        out.push(...blocksToDocx([block], depth + 1))
        first = false
      } else {
        out.push(...blocksToDocx([block], depth + 1))
      }
    }
  }

  return out
}

function tableToDocx(node: JSONContent): Table {
  const rows = node.content ?? []

  const docxRows = rows.map((row, rowIndex) => {
    const cells = (row.content ?? []).map((cell) => {
      const paragraphs = (cell.content ?? []).map((block) => {
        if (block.type === 'paragraph') {
          return new Paragraph({
            children: inlineChildren(block.content),
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
export function buildDocxDocument(doc: JSONContent, title: string): Document {
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
        children: blocksToDocx(doc.content ?? []),
      },
    ],
  })
}

/** Tiptap JSON → .docx Blob */
export async function jsonToDocxBlob(doc: JSONContent, title: string): Promise<Blob> {
  const document = buildDocxDocument(doc, title)
  return Packer.toBlob(document)
}
