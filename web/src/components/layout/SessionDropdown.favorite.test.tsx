// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { SessionDropdown } from './SessionDropdown'
import type { SessionSummary } from '@shared/types.js'

vi.mock('wouter', () => ({
  Link: ({ children, href, onClick }: any) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}))

const toggleFavorite = vi.fn()
const loadSession = vi.fn()

const storeState = {
  loadSession,
  toggleFavorite,
}

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}))

const sessions = [
  {
    id: 'session-1',
    title: 'Alpha',
    projectId: 'project-1',
    workdir: '/tmp/project',
    mode: 'planner' as const,
    phase: 'plan' as const,
    isRunning: false,
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    isFavorite: false,
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 0,
  },
  {
    id: 'session-2',
    title: 'Beta',
    projectId: 'project-1',
    workdir: '/tmp/project',
    mode: 'planner' as const,
    phase: 'build' as const,
    isRunning: false,
    createdAt: '2026-08-01T11:00:00Z',
    updatedAt: '2026-08-01T11:00:00Z',
    isFavorite: true,
    criteriaCount: 0,
    criteriaCompleted: 0,
    messageCount: 0,
  },
]

const currentProject = { id: 'project-1', name: 'Project', workdir: '/tmp/project' }

function render(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return container
}

function clickTrigger(container: HTMLElement) {
  const trigger = container.querySelector('[data-testid="header-session-dropdown"]')
  if (!trigger) throw new Error('Trigger button not found')
  act(() => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function getStars(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll(
      '[data-testid="session-dropdown-menu"] button[title="Favorite session"], [data-testid="session-dropdown-menu"] button[title="Unfavorite session"]',
    ),
  )
}

describe('SessionDropdown favorites', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('places favorite sessions before non-favorites regardless of recency', () => {
    const recentNonFavorite: SessionSummary = {
      ...sessions[0]!,
      id: 'session-3',
      title: 'Gamma',
      updatedAt: '2026-08-01T12:00:00Z',
      createdAt: '2026-08-01T12:00:00Z',
      isFavorite: false,
    }
    const container = render(
      <SessionDropdown
        sessions={[...sessions, recentNonFavorite]}
        currentProject={currentProject}
        currentSession={null}
      />,
    )
    clickTrigger(container)
    const menu = document.querySelector('[data-testid="session-dropdown-menu"]')
    const text = menu?.textContent ?? ''
    expect(text.indexOf('Beta')).toBeLessThan(text.indexOf('Gamma'))
  })

  it('renders a filled star for favorite sessions and an empty star for non-favorites', () => {
    const container = render(
      <SessionDropdown sessions={sessions} currentProject={currentProject} currentSession={null} />,
    )
    clickTrigger(container)
    const menu = document.querySelector('[data-testid="session-dropdown-menu"]')
    expect(menu?.textContent).toContain('Alpha')
    expect(menu?.textContent).toContain('Beta')
    const buttons = getStars()
    expect(buttons.length).toBeGreaterThanOrEqual(2)
  })

  it('toggles favorite without navigating on star click', () => {
    const container = render(
      <SessionDropdown sessions={sessions} currentProject={currentProject} currentSession={null} />,
    )
    clickTrigger(container)
    const menu = document.querySelector('[data-testid="session-dropdown-menu"]')
    const betaStar = menu?.querySelector('button[title="Unfavorite session"]')
    expect(betaStar).toBeTruthy()
    act(() => {
      betaStar?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(toggleFavorite).toHaveBeenCalledWith('session-2', false)
    expect(loadSession).not.toHaveBeenCalled()
  })
})
