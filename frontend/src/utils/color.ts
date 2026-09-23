/** 用户头像/协作光标的稳定配色（按名字哈希，跨端一致） */
const PALETTE = ['#e57373', '#f06292', '#7986cb', '#4db6ac', '#81c784', '#ffb74d', '#9575cd']

/** 按名字取调色板下标（0-based） */
export function hashToIndex(name: string): number {
  let hash = 0
  for (const ch of name) hash = (hash + ch.charCodeAt(0)) % PALETTE.length
  return hash
}

/** 按名字取稳定颜色；匿名回落首个颜色 */
export function userColor(name: string | null | undefined): string {
  return PALETTE[hashToIndex(name ?? '匿名')]
}
