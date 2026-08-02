import { Router, type Request, type Response } from 'express'
import type { SessionManager } from '../session/manager.js'

export function registerSessionFavoriteRoute(router: Router, sessionManager: Pick<SessionManager, 'getSession'>): void {
  router.put('/sessions/:id/favorite', async (req: Request, res: Response) => {
    const id = req.params['id'] as string
    const { toggleFavorite } = await import('../db/sessions.js')
    const { isFavorite } = req.body
    if (typeof isFavorite !== 'boolean') {
      return res.status(400).json({ error: 'isFavorite is required and must be a boolean' })
    }
    const session = sessionManager.getSession(id)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }
    toggleFavorite(id, isFavorite)
    res.json({ success: true })
  })
}
