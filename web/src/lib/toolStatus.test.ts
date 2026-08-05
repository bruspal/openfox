import { describe, it, expect } from 'vitest'
import { deriveToolCallStatus } from './toolStatus'
import type { ToolResult } from '@shared/types.js'

describe('deriveToolCallStatus', () => {
  const result = (partial: Partial<ToolResult>): ToolResult => ({
    success: false,
    durationMs: 1,
    truncated: false,
    ...partial,
  })

  it('is pending when there is no result yet', () => {
    expect(deriveToolCallStatus(undefined)).toBe('pending')
  })

  it('is success when the result succeeded', () => {
    expect(deriveToolCallStatus(result({ success: true, output: 'contents' }))).toBe('success')
  })

  it('is success when output merely mentions the interrupt marker (read_file of shell.ts)', () => {
    // Regression: a file whose content contains the literal "[interrupted by user]"
    // string (e.g. shell.ts source) must not be mistaken for an interrupted run.
    const output = "  if (output) output += '\\n\\n'\n        output += '[interrupted by user]'\n        resolve({\n"
    expect(deriveToolCallStatus(result({ success: true, output }))).toBe('success')
  })

  it('is success even when output ends with the marker text but the call succeeded', () => {
    // A file that literally ends with the marker (and was read successfully)
    // is still a successful read, not an interrupt.
    expect(deriveToolCallStatus(result({ success: true, output: '...\n\n[interrupted by user]' }))).toBe('success')
  })

  it('is interrupted when the run failed and output ends with the marker', () => {
    const output = 'some stdout\n\n[interrupted by user]'
    expect(deriveToolCallStatus(result({ success: false, output }))).toBe('interrupted')
  })

  it('is error when a failed run mentions the marker mid-output but ends differently', () => {
    const output = "grep found: '[interrupted by user]'\n[Exit code: 1]"
    expect(deriveToolCallStatus(result({ success: false, output }))).toBe('error')
  })

  it('is error when the run failed without the marker', () => {
    expect(deriveToolCallStatus(result({ success: false, output: 'boom', error: 'Command exited with code 1' }))).toBe(
      'error',
    )
  })

  it('is error when the run failed with no output at all', () => {
    expect(deriveToolCallStatus(result({ success: false, error: 'File not found' }))).toBe('error')
  })
})
