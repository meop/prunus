import { config } from './config.ts'
import { queueDepth } from './queue.ts'

export async function getHealth() {
  const { getStore } = await import('./db/index.ts')
  let dbStatus = 'disconnected'
  try {
    await getStore().getNotesNeedingReindex('__health_probe__')
    dbStatus = 'connected'
  } catch (_e) { /* not ready */ }

  let embedService = 'unavailable'
  try {
    const resp = await fetch(`${config.llm.baseUrl}/`, { signal: AbortSignal.timeout(2000) })
    if (resp.ok || resp.status < 500) embedService = 'available'
  } catch (_e) { /* unreachable */ }

  return {
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    db: `${config.db.type}:${dbStatus}`,
    embed_service: embedService,
    queue_depth: queueDepth(),
  }
}
