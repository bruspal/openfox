/**
 * Derive the display status of a tool call from its result.
 *
 * Semantics:
 * - no result yet          -> 'pending'
 * - success                -> 'success'
 * - interrupted by user    -> 'interrupted'
 * - anything else          -> 'error'
 *
 * "Interrupted" is detected from the abort marker that run_command appends to
 * the very end of its output when a run is aborted (success is false, the
 * marker is the last thing written). It must NOT be detected from content that
 * merely mentions the marker text — e.g. read_file of a file that contains the
 * literal string (shell.ts does) is a successful read, not an interrupt.
 */
import type { ToolResult } from '@shared/types.js'

export type ToolStatus = 'pending' | 'success' | 'error' | 'interrupted'

const INTERRUPTED_MARKER = '[interrupted by user]'

export function deriveToolCallStatus(result: ToolResult | undefined): ToolStatus {
  if (!result) return 'pending'

  const output = result.output ?? ''
  const wasInterrupted = !result.success && output.trimEnd().endsWith(INTERRUPTED_MARKER)
  if (wasInterrupted) return 'interrupted'

  return result.success ? 'success' : 'error'
}
