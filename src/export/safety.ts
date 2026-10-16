/** Keep filenames portable and spreadsheet text inert when opened in office apps. */
export function safeFileName(name: string, extension: 'pdf' | 'xlsx'): string {
  let base = name.normalize('NFKC').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g, '_').replace(/^\.+|[. ]+$/g, '').trim().slice(0, 90)
  if (!base) base = '3D报价单'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `报价_${base}`
  return `${base}.${extension}`
}

export function spreadsheetText(value: string): string {
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
  return /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel a browser's download before it starts.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
