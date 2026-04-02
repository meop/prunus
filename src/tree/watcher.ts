import { walk } from '@std/fs'

import { SETTINGS } from '../stng.ts'
import { log } from '../log.ts'
import { enqueue } from '../queue.ts'

async function initialScan(treeName: string, treePath: string): Promise<void> {
  let count = 0
  for await (const entry of walk(treePath, { exts: ['.md'], includeDirs: false, skip: [/\/\.profiles(\/|$)/] })) {
    const rel = entry.path.slice(treePath.length + 1)
    enqueue({ type: 'survey', tree: treeName, path: rel })
    count++
  }
  log.info('watcher', `initial scan [${treeName}]: ${count} file(s) queued`)
}

export async function startTreeWatcher(): Promise<void> {
  const base = SETTINGS.grove.path
  const trees: string[] = []

  try {
    for await (const entry of Deno.readDir(base)) {
      if (entry.isDirectory && !entry.name.startsWith('.')) trees.push(entry.name)
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied)) {
      throw e
    }
    log.warn('watcher', `trees base not accessible: ${base}`)
    return
  }

  if (trees.length === 0) {
    log.warn('watcher', `no tree subdirectories found in ${base}`)
    return
  }

  for (const tree of trees) {
    try {
      await initialScan(tree, `${base}/${tree}`)
    } catch (err) {
      log.warn('watcher', `initial scan failed for tree ${tree}`, String(err))
    }
  }

  log.info('watcher', `watching ${base} (${trees.join(', ')})`)
  const watcher = Deno.watchFs(base, { recursive: true })

  for await (const event of watcher) {
    if (event.kind !== 'create' && event.kind !== 'modify' && event.kind !== 'remove') continue
    for (const path of event.paths) {
      if (!path.endsWith('.md')) continue
      const rel = path.slice(base.length + 1)
      const slash = rel.indexOf('/')
      if (slash === -1) continue
      const tree = rel.slice(0, slash)
      const filePath = rel.slice(slash + 1)
      if (filePath.startsWith('.profiles/') || filePath.includes('/.profiles/')) continue
      if (event.kind === 'remove') {
        // triggerHeal=true: human deleted a note, semantic cleanup needed
        enqueue({ type: 'prune', tree, path: filePath, triggerHeal: true })
      } else {
        enqueue({ type: 'survey', tree, path: filePath })
        enqueue({
          type: 'heal',
          tree,
          changedPath: filePath,
          summary: filePath.replace(/\.md$/, ''),
          change: 'modified',
        })
      }
    }
  }
}
