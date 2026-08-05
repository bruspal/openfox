import type { ChoiceOption } from './protocol.js'

/**
 * Coerce whatever the LLM / legacy storage handed us into the canonical
 * `ChoiceOption[]` shape. Non-lossy: `description` is preserved when present.
 *
 * Accepted input shapes (none of them leak raw through):
 *   - `undefined` / `null`                                  → `undefined`
 *   - `string`                                              `"A, B"` (comma-split) → each as `ChoiceOption`
 *   - `string[]`                                            → `{value:s,label:s}` per entry
 *   - `Array<{label, description?}>`                        → `{value:label,label,description}`
 *   - `Array<{value, label, description?}>`                 → preserve all three fields
 *   - Anything else (numbers, booleans, malformed objects)  → silently dropped
 *
 * This is the SINGLE normalization point shared by server and web. Downstream
 * consumers (ask_user boundary, chat.ask_user event, fold-state replay,
 * session.state.pendingQuestions, REST /api/sessions/:id, AskUserCard) all
 * trust the canonical `ChoiceOption[]` shape from here. The web client keeps
 * accepting legacy `string[]` and `{label,description}[]` shapes for
 * sessions/events persisted by pre-fix builds via the same function.
 *
 * Returns `undefined` when nothing usable remains (callers fall through to
 * free-text input).
 */
export function normalizeAskOptions(raw: unknown): ChoiceOption[] | undefined {
  if (raw == null) return undefined
  if (typeof raw === 'string') {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return parts.length > 0 ? parts.map((label) => ({ value: label, label })) : undefined
  }
  if (!Array.isArray(raw)) return undefined

  const out: ChoiceOption[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (trimmed.length > 0) {
        out.push({ value: trimmed, label: trimmed })
      }
      continue
    }
    if (item != null && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      const labelRaw = obj['label']
      const valueRaw = obj['value']
      // A non-empty string label is the minimum requirement for a usable option.
      if (typeof labelRaw === 'string' && labelRaw.trim().length > 0) {
        const label = labelRaw.trim()
        // Prefer an explicit `value` (LLM may emit it); otherwise fall back to label.
        const value = typeof valueRaw === 'string' && valueRaw.length > 0 ? valueRaw : label
        const descRaw = obj['description']
        const opt: ChoiceOption = {
          value,
          label,
        }
        if (typeof descRaw === 'string' && descRaw.length > 0) {
          opt.description = descRaw
        }
        out.push(opt)
      }
      // Malformed objects (no usable string label) are silently dropped.
    }
    // Primitives other than string (numbers, booleans, null, undefined) are dropped.
  }
  return out.length > 0 ? out : undefined
}
