const UTF8_2BYTES_START = 0x80
const UTF8_3BYTES_START = 0x800
const UTF8_4BYTES_START = 65536
/**
 * No need to create Buffer
 */
export function byteSlice(content: string, start: number, end?: number): string {
  const si = characterIndex(content, start)
  const ei = end === undefined ? undefined : characterIndex(content, end)
  return content.slice(si, ei)
}

export function characterIndex(content: string, byteIndex: number): number {
  if (byteIndex == 0) return 0
  let characterIndex = 0
  let total = 0
  for (const codePoint of content) {
    const code = codePoint.codePointAt(0) ?? 0
    if (code >= UTF8_4BYTES_START) {
      characterIndex += 2
      total += 4
    } else {
      characterIndex += 1
      total += utf8_code2len(code)
    }
    if (total >= byteIndex) break
  }
  return characterIndex
}

export function utf8_code2len(code: number): number {
  if (code < UTF8_2BYTES_START) return 1
  if (code < UTF8_3BYTES_START) return 2
  if (code < UTF8_4BYTES_START) return 3
  return 4
}
