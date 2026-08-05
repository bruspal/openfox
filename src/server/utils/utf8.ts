import { StringDecoder } from 'node:string_decoder'

export function decodeUtf8(chunks: readonly Buffer[]): string {
  return Buffer.concat([...chunks]).toString('utf8')
}

export interface Utf8StreamDecoder {
  write(chunk: Buffer): string
  end(): string
}

export function createUtf8StreamDecoder(): Utf8StreamDecoder {
  const decoder = new StringDecoder('utf8')
  return {
    write: (chunk) => decoder.write(chunk),
    end: () => decoder.end(),
  }
}

export function sanitizeUtf8(content: string): { clean: string; corrupted: boolean } {
  if (!content.includes('\ufffd')) return { clean: content, corrupted: false }
  return { clean: content.replaceAll('\ufffd', '?'), corrupted: true }
}
