// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from 'vitest'
import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { useAutoScroll, scrollbarGestureToEnable, DRAG_MAGNET_GAP_PX } from './useAutoScroll'
import type { Session } from '@shared/types.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface Metrics {
  scrollHeight: number
  offsetHeight: number
}

const BASE: Metrics = { scrollHeight: 1080, offsetHeight: 720 }

function makeScroller() {
  const metrics: Metrics = { ...BASE }
  const el = document.createElement('div')
  let scrollTop = metrics.scrollHeight - metrics.offsetHeight
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => metrics.scrollHeight })
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => metrics.offsetHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = Math.min(Math.max(v, 0), metrics.scrollHeight - metrics.offsetHeight)
    },
  })
  document.body.appendChild(el)
  return { el, metrics }
}

const flushRaf = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 80)
      }),
  )

const cleanups: Array<() => void> = []

function setup() {
  const scroller = makeScroller()
  const hook = renderHook(() => useAutoScroll({ current: scroller.el }, null, () => scroller.el))
  cleanups.push(() => {
    hook.unmount()
    scroller.el.remove()
  })
  return { el: scroller.el, metrics: scroller.metrics, result: hook.result }
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

describe('scrollbarGestureToEnable', () => {
  it('never enables on pointer down', () => {
    expect(scrollbarGestureToEnable('down', 0)).toBe(false)
    expect(scrollbarGestureToEnable('down', null)).toBe(false)
  })

  it('enables only within the magnet gap', () => {
    expect(scrollbarGestureToEnable('move', 512)).toBe(false)
    expect(scrollbarGestureToEnable('move', DRAG_MAGNET_GAP_PX)).toBe(true)
    expect(scrollbarGestureToEnable('move', 0)).toBe(true)
    expect(scrollbarGestureToEnable('up', 432)).toBe(false)
    expect(scrollbarGestureToEnable('up', DRAG_MAGNET_GAP_PX)).toBe(true)
    expect(scrollbarGestureToEnable('up', null)).toBe(false)
  })
})

describe('useAutoScroll', () => {
  it('re-anchors to the bottom on session load even when a stray scroll event fires at the top first', async () => {
    // Fresh loads start at the top (scrollTop 0) with a tall feed; a stray
    // scroll event can fire before the first bottom-anchor, which used to
    // disable autoscroll permanently and strand the feed at the top.
    const scroller = makeScroller()
    scroller.el.scrollTop = 0
    const hook = renderHook<ReturnType<typeof useAutoScroll>, { id: string | null }>(
      (props) =>
        useAutoScroll(
          { current: scroller.el },
          (props.id ? { id: props.id } : null) as Session | null,
          () => scroller.el,
        ),
      { initialProps: { id: null } },
    )
    cleanups.push(() => {
      hook.unmount()
      scroller.el.remove()
    })

    // Session loads; a stray scroll event lands at the top before any anchor.
    scroller.el.scrollTop = 0
    act(() => scroller.el.dispatchEvent(new Event('scroll')))
    act(() => hook.rerender({ id: 'session-1' }))
    await flushRaf()
    await flushRaf()

    expect(hook.result.current.isAutoScrollActive).toBe(true)
    expect(scroller.el.scrollTop).toBe(scroller.metrics.scrollHeight - scroller.metrics.offsetHeight)
  })

  it('keeps auto-scroll on when a programmatic jump is followed by a late scroll event after content grew', () => {
    const { el, metrics, result } = setup()
    expect(result.current.isAutoScrollActive).toBe(true)

    act(() => result.current.force_scroll_to_bottom())
    expect(el.scrollTop).toBe(360)

    metrics.scrollHeight = 1720
    act(() => el.dispatchEvent(new Event('scroll')))
    act(() => el.dispatchEvent(new Event('scroll')))
    expect(result.current.isAutoScrollActive).toBe(true)
  })

  it('detaches when the user genuinely scrolls away from the bottom', () => {
    const { el, result } = setup()

    el.scrollTop = 302
    act(() => el.dispatchEvent(new Event('scroll')))
    expect(result.current.isAutoScrollActive).toBe(false)
  })

  it('re-engages (magnet) when a user scroll lands within the 2px threshold of the bottom', () => {
    const { el, result } = setup()

    el.scrollTop = 118
    act(() => el.dispatchEvent(new Event('scroll')))
    expect(result.current.isAutoScrollActive).toBe(false)

    el.scrollTop = 378
    act(() => el.dispatchEvent(new Event('scroll')))
    expect(result.current.isAutoScrollActive).toBe(true)
  })

  it('detaches on wheel-up and re-engages on wheel-down within 100px of the bottom', async () => {
    const { el, result } = setup()

    act(() => el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })))
    expect(result.current.isAutoScrollActive).toBe(false)

    el.scrollTop = 316
    await flushRaf()
    act(() => el.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 })))
    await flushRaf()
    expect(result.current.isAutoScrollActive).toBe(true)
  })

  it('does not re-engage on wheel-down when far from the bottom', async () => {
    const { el, result } = setup()

    el.scrollTop = 252
    act(() => el.dispatchEvent(new Event('scroll')))
    expect(result.current.isAutoScrollActive).toBe(false)

    await flushRaf()
    act(() => el.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 })))
    await flushRaf()
    expect(result.current.isAutoScrollActive).toBe(false)
  })

  it('does not snap back to the bottom after wheel-up when a follow RAF was already queued', async () => {
    const { el, metrics, result } = setup()
    act(() => result.current.force_scroll_to_bottom())
    expect(result.current.isAutoScrollActive).toBe(true)

    metrics.scrollHeight = 3260

    const rafs: FrameRequestCallback[] = []
    const originalRaf = window.requestAnimationFrame.bind(window)
    const spy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafs.push(cb)
      return rafs.length
    })
    try {
      act(() => el.append(document.createElement('div')))
      await act(async () => {})
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
      expect(rafs.length).toBeGreaterThan(0)

      act(() => el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })))
      expect(result.current.isAutoScrollActive).toBe(false)

      el.scrollTop = 1520
      act(() => {
        for (const cb of rafs.splice(0)) originalRaf(cb)
      })
      await act(async () => new Promise((resolve) => setTimeout(resolve, 35)))

      expect(result.current.isAutoScrollActive).toBe(false)
      expect(el.scrollTop).toBe(1520)
    } finally {
      spy.mockRestore()
    }
  })

  it('does not re-enable from a delayed scroll event of a follow that landed right before wheel-up', () => {
    const { el, result } = setup()
    act(() => result.current.force_scroll_to_bottom())
    expect(result.current.isAutoScrollActive).toBe(true)

    act(() => el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })))
    expect(result.current.isAutoScrollActive).toBe(false)

    act(() => el.dispatchEvent(new Event('scroll')))
    expect(result.current.isAutoScrollActive).toBe(false)
  })

  it('disables instantly on scrollbar pointer-down and ignores scroll events while dragging', () => {
    const { el, result } = setup()

    act(() => result.current.handleScrollbarGesture('down', 268))
    expect(result.current.isAutoScrollActive).toBe(false)

    act(() => el.dispatchEvent(new Event('scroll')))
    expect(result.current.isAutoScrollActive).toBe(false)

    act(() => result.current.handleScrollbarGesture('up', 262))
  })

  it('magnets on when the dragged handle approaches the end of the gutter and sticks after release', () => {
    const { result } = setup()

    act(() => result.current.handleScrollbarGesture('down', 291))
    expect(result.current.isAutoScrollActive).toBe(false)

    act(() => result.current.handleScrollbarGesture('move', 261))
    expect(result.current.isAutoScrollActive).toBe(false)

    act(() => result.current.handleScrollbarGesture('move', 3))
    expect(result.current.isAutoScrollActive).toBe(true)

    act(() => result.current.handleScrollbarGesture('move', 188))
    expect(result.current.isAutoScrollActive).toBe(false)

    act(() => result.current.handleScrollbarGesture('up', 285))
    expect(result.current.isAutoScrollActive).toBe(false)
  })

  it('releases near the bottom of the gutter snap auto-scroll on and survives late scroll events', () => {
    const { el, result } = setup()

    act(() => result.current.handleScrollbarGesture('down', 232))
    expect(result.current.isAutoScrollActive).toBe(false)

    act(() => result.current.handleScrollbarGesture('up', 2))
    expect(result.current.isAutoScrollActive).toBe(true)

    act(() => el.dispatchEvent(new Event('scroll')))
    expect(result.current.isAutoScrollActive).toBe(true)
  })

  it('force_scroll_to_bottom re-enables auto-scroll and scrolls to the bottom', () => {
    const { el, result } = setup()

    el.scrollTop = 274
    act(() => el.dispatchEvent(new Event('scroll')))
    expect(result.current.isAutoScrollActive).toBe(false)

    act(() => result.current.force_scroll_to_bottom())
    expect(result.current.isAutoScrollActive).toBe(true)
    expect(el.scrollTop).toBe(360)
  })

  it('setAutoScroll(false) detaches and setAutoScroll(true) re-attaches', () => {
    const { el, metrics, result } = setup()

    act(() => result.current.setAutoScroll(false))
    expect(result.current.isAutoScrollActive).toBe(false)

    metrics.scrollHeight = 1860
    act(() => result.current.setAutoScroll(true))
    expect(result.current.isAutoScrollActive).toBe(true)
    expect(el.scrollTop).toBe(1140)
  })

  it('does not detach while actively following when content height explodes in bursts', () => {
    vi.useFakeTimers()
    try {
      const { el, metrics, result } = setup()
      act(() => result.current.force_scroll_to_bottom())
      expect(result.current.isAutoScrollActive).toBe(true)

      metrics.scrollHeight = 5940
      metrics.offsetHeight = 760
      for (const top of [560, 930, 1490, 2240, 3410]) {
        el.scrollTop = top
        act(() => el.dispatchEvent(new Event('scroll')))
      }
      expect(result.current.isAutoScrollActive).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('detaches via lone scroll events once following has been idle for more than the guard window', () => {
    vi.useFakeTimers()
    try {
      const { el, metrics, result } = setup()
      act(() => result.current.force_scroll_to_bottom())
      expect(result.current.isAutoScrollActive).toBe(true)
      act(() => vi.advanceTimersByTime(100))

      metrics.scrollHeight = 4940
      vi.setSystemTime(Date.now() + 4600)
      el.scrollTop = 690
      act(() => el.dispatchEvent(new Event('scroll')))
      expect(result.current.isAutoScrollActive).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
  it('detaches immediately on ArrowUp even while actively following', () => {
    vi.useFakeTimers()
    try {
      const { el, result } = setup()
      act(() => result.current.force_scroll_to_bottom())
      expect(result.current.isAutoScrollActive).toBe(true)

      act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
      expect(result.current.isAutoScrollActive).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('detaches on PageUp and Home', () => {
    const { el, result } = setup()

    act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true })))
    expect(result.current.isAutoScrollActive).toBe(false)

    act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(result.current.isAutoScrollActive).toBe(false)
  })

  it('re-engages on End when near the bottom after being detached', async () => {
    const { el, result } = setup()

    act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
    expect(result.current.isAutoScrollActive).toBe(false)

    el.scrollTop = 375
    await flushRaf()
    act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    await flushRaf()
    expect(result.current.isAutoScrollActive).toBe(true)
  })

  it('does not re-engage on ArrowDown when far from the bottom', async () => {
    const { el, result } = setup()

    act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
    expect(result.current.isAutoScrollActive).toBe(false)

    el.scrollTop = 161
    await flushRaf()
    act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    await flushRaf()
    expect(result.current.isAutoScrollActive).toBe(false)
  })
})
