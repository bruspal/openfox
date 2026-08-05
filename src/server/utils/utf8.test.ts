import { describe, it, expect } from 'vitest'
import { decodeUtf8, createUtf8StreamDecoder, sanitizeUtf8 } from './utf8.js'

describe('decodeUtf8', () => {
  it('decodes a single chunk', () => {
    expect(decodeUtf8([Buffer.from('hello')])).toBe('hello')
  })

  it('joins multiple chunks losslessly', () => {
    expect(decodeUtf8([Buffer.from('ab'), Buffer.from('cd'), Buffer.from('ef')])).toBe('abcdef')
  })

  it('keeps a multi-byte char intact when split across chunk boundaries', () => {
    // '│' is U+2502, encoded as E2 94 82 (3 bytes)
    const bytes = Buffer.from('a│b', 'utf8')
    const cut = 2 // split inside the 3-byte sequence
    const first = bytes.subarray(0, cut)
    const rest = bytes.subarray(cut)

    const decoded = decodeUtf8([first, rest])

    expect(decoded).toBe('a│b')
    expect(decoded).not.toContain('\ufffd')
  })

  it('preserves multi-byte chars at every split position', () => {
    const bytes = Buffer.from('│││', 'utf8')
    for (let cut = 1; cut < bytes.length; cut++) {
      const decoded = decodeUtf8([bytes.subarray(0, cut), bytes.subarray(cut)])
      expect(decoded).toBe('│││')
      expect(decoded).not.toContain('\ufffd')
    }
  })

  it('handles an empty chunk list', () => {
    expect(decodeUtf8([])).toBe('')
  })
})

describe('createUtf8StreamDecoder', () => {
  it('holds a partial multi-byte sequence until the next chunk', () => {
    const decoder = createUtf8StreamDecoder()
    const bytes = Buffer.from('x│y', 'utf8')
    const cut = bytes.indexOf(0x94) // split mid-sequence

    // Naive per-chunk toString() would emit U+FFFD here
    const first = decoder.write(bytes.subarray(0, cut))
    const second = decoder.write(bytes.subarray(cut))

    expect(first + second).toBe('x│y')
    expect(first).not.toContain('\ufffd')
    expect(second).not.toContain('\ufffd')
    expect(decoder.end()).toBe('')
  })

  it('never emits a replacement char mid-stream; only a truly dangling byte at EOF does', () => {
    const decoder = createUtf8StreamDecoder()
    const bytes = Buffer.from('z│', 'utf8')
    const first = decoder.write(bytes.subarray(0, 2)) // 'z' + lead byte of '│'
    const rest = decoder.end() // lead byte alone can't be completed -> U+FFFD

    expect(first).toBe('z')
    expect(first).not.toContain('\ufffd')
    expect(rest).toBe('\ufffd')
  })
})

describe('sanitizeUtf8', () => {
  it('passes clean content through untouched', () => {
    const result = sanitizeUtf8('│ Format │ Files │')
    expect(result.clean).toBe('│ Format │ Files │')
    expect(result.corrupted).toBe(false)
  })

  it('replaces U+FFFD with a placeholder and flags corruption', () => {
    const result = sanitizeUtf8('0 (0%) \ufffd\ufffd\ufffd')
    expect(result.clean).toBe('0 (0%) ???')
    expect(result.corrupted).toBe(true)
  })

  it('returns empty string unchanged', () => {
    expect(sanitizeUtf8('').clean).toBe('')
    expect(sanitizeUtf8('').corrupted).toBe(false)
  })
})
