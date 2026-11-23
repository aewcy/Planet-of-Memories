/**
 * Compress an image file in the browser before uploading so overseas servers
 * and Vision LLMs respond quickly with minimal bandwidth/token cost.
 */
export async function compressImage(
  file: File,
  maxDimension = 1440,
  quality = 0.82
): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file
  }

  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap

  let targetW = width
  let targetH = height
  if (width > maxDimension || height > maxDimension) {
    if (width >= height) {
      targetW = maxDimension
      targetH = Math.round((height / width) * maxDimension)
    } else {
      targetH = maxDimension
      targetW = Math.round((width / height) * maxDimension)
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }

  ctx.drawImage(bitmap, 0, 0, targetW, targetH)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  )
  if (!blob) return file

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo'
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' })
}
