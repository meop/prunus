import { walk } from '@std/fs'
import { config } from '../config.ts'
import { log } from '../log.ts'
import { enqueue } from '../queue.ts'

async function initialScan(vaultName: string, vaultPath: string): Promise<void> {
  let count = 0
  for await (const entry of walk(vaultPath, { exts: ['.md'], includeDirs: false })) {
    const rel = entry.path.slice(vaultPath.length + 1)
    enqueue({ type: 'reindex', vault: vaultName, path: rel })
    count++
  }
  log.info('watcher', `initial scan [${vaultName}]: ${count} file(s) queued`)
}

export async function startVaultWatcher(): Promise<void> {
  const base = config.vault.base
  const vaults: string[] = []

  try {
    for await (const entry of Deno.readDir(base)) {
      if (entry.isDirectory && !entry.name.startsWith('.')) vaults.push(entry.name)
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied)) {
      throw e
    }
    log.warn('watcher', `vaults base not accessible: ${base}`)
    return
  }

  if (vaults.length === 0) {
    log.warn('watcher', `no vault subdirectories found in ${base}`)
    return
  }

  for (const vault of vaults) {
    try {
      await initialScan(vault, `${base}/${vault}`)
    } catch (err) {
      log.warn('watcher', `initial scan failed for vault ${vault}`, String(err))
    }
  }

  log.info('watcher', `watching ${base} (${vaults.join(', ')})`)
  const watcher = Deno.watchFs(base, { recursive: true })

  for await (const event of watcher) {
    if (event.kind !== 'create' && event.kind !== 'modify' && event.kind !== 'remove') continue
    for (const path of event.paths) {
      if (!path.endsWith('.md')) continue
      const rel = path.slice(base.length + 1)
      const slash = rel.indexOf('/')
      if (slash === -1) continue
      const vault = rel.slice(0, slash)
      const filePath = rel.slice(slash + 1)
      enqueue({ type: event.kind === 'remove' ? 'delete' : 'reindex', vault, path: filePath })
    }
  }
}
