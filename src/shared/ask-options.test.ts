import { describe, expect, it } from 'vitest'
import { normalizeAskOptions } from './ask-options.js'
import type { ChoiceOption } from './protocol.js'

describe('normalizeAskOptions (shared server/web contract)', () => {
  it('returns undefined for null/undefined input', () => {
    expect(normalizeAskOptions(undefined)).toBeUndefined()
    expect(normalizeAskOptions(null)).toBeUndefined()
  })

  it('returns undefined for non-array, non-string primitives', () => {
    expect(normalizeAskOptions(42)).toBeUndefined()
    expect(normalizeAskOptions(true)).toBeUndefined()
    expect(normalizeAskOptions({ label: 'A' })).toBeUndefined()
  })

  it('comma-splits a raw string into options (legacy web quirk)', () => {
    expect(normalizeAskOptions('A, B')).toEqual([
      { value: 'A', label: 'A' },
      { value: 'B', label: 'B' },
    ])
    expect(normalizeAskOptions('   ')).toBeUndefined()
  })

  it('trims string entries and drops empty ones', () => {
    expect(normalizeAskOptions([' A ', '', 'B', '   '])).toEqual([
      { value: 'A', label: 'A' },
      { value: 'B', label: 'B' },
    ])
  })

  it('preserves {label, description} as {value:label, label, description}', () => {
    expect(
      normalizeAskOptions([
        { label: 'Continuer', description: 'Reprendre le flux principal' },
        { label: 'Annuler', description: 'Stopper ici' },
      ]),
    ).toEqual([
      { value: 'Continuer', label: 'Continuer', description: 'Reprendre le flux principal' },
      { value: 'Annuler', label: 'Annuler', description: 'Stopper ici' },
    ])
  })

  it('preserves {value, label, description} verbatim', () => {
    expect(
      normalizeAskOptions([
        { value: 'yes-v', label: 'Oui', description: 'Accepter' },
        { value: 'no-v', label: 'Non', description: 'Refuser' },
      ]),
    ).toEqual([
      { value: 'yes-v', label: 'Oui', description: 'Accepter' },
      { value: 'no-v', label: 'Non', description: 'Refuser' },
    ])
  })

  it('handles mixed input shapes and never loses description', () => {
    const opts = normalizeAskOptions([
      'plain-string',
      { label: 'Has-desc', description: 'I have a description' },
      { value: 'with-all', label: 'WithAll', description: 'Triple field entry' },
    ])
    expect(opts?.length).toBe(3)
    const withDesc = opts?.filter((o) => o.description !== undefined)
    expect(withDesc).toEqual([
      { value: 'Has-desc', label: 'Has-desc', description: 'I have a description' },
      { value: 'with-all', label: 'WithAll', description: 'Triple field entry' },
    ])
  })

  it('silently drops malformed entries and never leaks raw objects', () => {
    const result = normalizeAskOptions([
      null,
      undefined,
      42,
      true,
      { label: 'OK' },
      { label: '' },
      { description: 'no label here' },
      { label: 123 },
      'legacy-string-entry',
    ] as unknown as unknown[])
    expect(result).toEqual([
      { value: 'OK', label: 'OK' },
      { value: 'legacy-string-entry', label: 'legacy-string-entry' },
    ])
    for (const item of result ?? []) {
      expect(typeof item).toBe('object')
      expect(item).not.toBeNull()
      expect(typeof (item as ChoiceOption).value).toBe('string')
      expect(typeof (item as ChoiceOption).label).toBe('string')
    }
  })

  it('returns undefined when every entry is malformed', () => {
    expect(
      normalizeAskOptions([null, undefined, 42, { label: '' }, { foo: 'bar' }] as unknown as unknown[]),
    ).toBeUndefined()
  })

  it('never aliases the input array', () => {
    const input = ['A', 'B']
    const result = normalizeAskOptions(input)
    expect(result).toEqual([
      { value: 'A', label: 'A' },
      { value: 'B', label: 'B' },
    ])
    expect(result).not.toBe(input)
  })
})
