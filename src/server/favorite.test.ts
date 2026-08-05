import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express, { type Router } from 'express'
import { createServer, type Server } from 'node:http'
import type { SessionManager } from './session/manager.js'
import { registerSessionFavoriteRoute } from './routes/session-favorite.js'

const { mockToggleFavorite } = vi.hoisted(() => ({ mockToggleFavorite: vi.fn() }))

vi.mock('./db/sessions.js', () => ({
  toggleFavorite: mockToggleFavorite,
}))

function mountFavoriteRoute(
  app: express.Express,
  deps: {
    sessionManager: Pick<SessionManager, 'getSession'>
  },
) {
  const router: Router = express.Router()
  registerSessionFavoriteRoute(router, deps.sessionManager)
  app.use(express.json())
  app.use('/api', router)
}

async function fetchJson(url: string, options?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, options)
  const body = await response.json()
  return { status: response.status, body }
}

describe('PUT /api/sessions/:id/favorite', () => {
  let server: Server
  let baseUrl: string
  let mockSessionManager: Pick<SessionManager, 'getSession'>

  async function startServer() {
    const app = express()
    mountFavoriteRoute(app, { sessionManager: mockSessionManager })
    return new Promise<void>((resolve) => {
      server = createServer(app)
      server.listen(0, () => {
        const addr = server.address()
        baseUrl = `http://localhost:${(addr as { port: number }).port}`
        resolve()
      })
    })
  }

  beforeEach(async () => {
    mockSessionManager = { getSession: vi.fn() }
    mockToggleFavorite.mockClear()
    await startServer()
  })

  afterEach(() => {
    server?.close()
  })

  it('returns 400 when isFavorite is not a boolean', async () => {
    ;(mockSessionManager.getSession as any).mockReturnValue({ id: 'test-session' })

    const { status, body } = await fetchJson(`${baseUrl}/api/sessions/test-session/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite: 'yes' }),
    })
    expect(status).toBe(400)
    expect(body).toEqual({ error: 'isFavorite is required and must be a boolean' })
    expect(mockToggleFavorite).not.toHaveBeenCalled()
  })

  it('returns 404 when session is not found', async () => {
    ;(mockSessionManager.getSession as any).mockReturnValue(null)

    const { status, body } = await fetchJson(`${baseUrl}/api/sessions/nonexistent/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite: true }),
    })
    expect(status).toBe(404)
    expect(body).toEqual({ error: 'Session not found' })
    expect(mockToggleFavorite).not.toHaveBeenCalled()
  })

  it('returns success and toggles favorite for an existing session', async () => {
    ;(mockSessionManager.getSession as any).mockReturnValue({ id: 'test-session' })

    const { status, body } = await fetchJson(`${baseUrl}/api/sessions/test-session/favorite`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isFavorite: true }),
    })
    expect(status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(mockToggleFavorite).toHaveBeenCalledWith('test-session', true)
  })
})
