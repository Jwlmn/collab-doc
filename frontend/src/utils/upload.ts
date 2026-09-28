import { api } from './request'

export interface UploadedImage {
  /** 编辑器可直接引用的相对 URL，如 /api/images/<uuid>.png */
  url: string
  filename: string
  size: number
}

/**
 * 上传图片到后端，返回可写进 image 节点的 URL。
 *
 * 刻意不存 base64：会撑爆 Y.js 状态与每个版本的 content_html。
 */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const form = new FormData()
  form.append('file', file)

  const { data } = await api.post('/images', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

  return data.data as UploadedImage
}

/** 取出文件列表/剪贴板里的第一个图片文件 */
export function firstImageFile(files: FileList | null | undefined): File | null {
  if (!files || files.length === 0) return null
  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/')) return file
  }
  return null
}
