import { describe, expect, it } from 'vitest'
import { shouldCompact } from './compactor.js'

describe('context compactor helpers', () => {
  it('decides when compaction should happen', () => {
    expect(shouldCompact(161_000, 200_000, 0.8)).toBe(true)
    expect(shouldCompact(160_000, 200_000, 0.8)).toBe(false)
    expect(shouldCompact(10_000, 200_000, 0.8)).toBe(false)
  })

  it('disables compaction when threshold is zero', () => {
    expect(shouldCompact(200_000, 200_000, 0)).toBe(false)
  })

  it('honors configured threshold up to the 0.95 cap', () => {
    // 200K model, threshold 0.9: below cap and headroom ceiling → fires at 180K
    expect(shouldCompact(181_000, 200_000, 0.9)).toBe(true)
    expect(shouldCompact(179_000, 200_000, 0.9)).toBe(false)
  })

  it('caps threshold at 0.95 for large models', () => {
    // 500K model, threshold 0.96: clamped to 0.95 → fires at 475K, not 480K
    expect(shouldCompact(476_000, 500_000, 0.96)).toBe(true)
    expect(shouldCompact(474_000, 500_000, 0.96)).toBe(false)
  })

  it('respects configured threshold above the old 0.85 default', () => {
    // 500K model, threshold 0.92: honored as-is → fires at 460K, not 425K
    expect(shouldCompact(461_000, 500_000, 0.92)).toBe(true)
    expect(shouldCompact(459_000, 500_000, 0.92)).toBe(false)
  })

  it('caps threshold for small models to preserve headroom', () => {
    // 8K model: ceiling = min(3K, 6.8K) = 3K → 37.5%
    // At 3.5K tokens with threshold 0.9: clamped to 0.375 → 3.5K > 3K → true
    expect(shouldCompact(3_500, 8_000, 0.9)).toBe(true)
    // At 2.5K tokens with threshold 0.9: clamped to 0.375 → 2.5K < 3K → false
    expect(shouldCompact(2_500, 8_000, 0.9)).toBe(false)
  })

  it('does not affect normal thresholds below the ceiling', () => {
    // 200K model, threshold 0.5: well below ceiling → normal behavior
    expect(shouldCompact(101_000, 200_000, 0.5)).toBe(true)
    expect(shouldCompact(99_000, 200_000, 0.5)).toBe(false)
  })
})
