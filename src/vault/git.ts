import { log } from '../log.ts'

const AUTHOR = 'prunus <prunus@local>'

async function git(cwd: string, args: string[]): Promise<number> {
  const { code } = await new Deno.Command('git', { args, cwd, stderr: 'null', stdout: 'null' }).output()
  return code
}

async function hasStagedChanges(vaultPath: string): Promise<boolean> {
  // exit 1 = staged changes exist, exit 0 = nothing staged
  return (await git(vaultPath, ['diff', '--cached', '--quiet'])) !== 0
}

export async function ensureGitRepo(vaultPath: string): Promise<void> {
  try {
    await Deno.stat(`${vaultPath}/.git`)
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      throw e
    }
    const code = await git(vaultPath, ['init'])
    if (code !== 0) throw new Error(`git init failed in ${vaultPath}`)
    log.info('git', `initialized repo: ${vaultPath}`)
  }
}

export async function commitFile(vaultPath: string, relativePath: string): Promise<void> {
  const code = await git(vaultPath, ['add', relativePath])
  if (code !== 0) throw new Error(`git add failed: ${relativePath}`)
  if (!await hasStagedChanges(vaultPath)) return
  const commitCode = await git(vaultPath, ['commit', '-m', relativePath, `--author=${AUTHOR}`])
  if (commitCode !== 0) throw new Error(`git commit failed: ${relativePath}`)
}

export async function commitBatch(vaultPath: string, paths: string[], message: string): Promise<void> {
  for (const p of paths) {
    const code = await git(vaultPath, ['add', p])
    if (code !== 0) throw new Error(`git add failed: ${p}`)
  }
  if (!await hasStagedChanges(vaultPath)) return
  const code = await git(vaultPath, ['commit', '-m', message, `--author=${AUTHOR}`])
  if (code !== 0) throw new Error(`git commit failed: ${message}`)
}

export async function commitRemove(vaultPath: string, relativePath: string): Promise<void> {
  const code = await git(vaultPath, ['rm', '--cached', '--ignore-unmatch', relativePath])
  if (code !== 0) throw new Error(`git rm failed: ${relativePath}`)
  if (!await hasStagedChanges(vaultPath)) return
  const commitCode = await git(vaultPath, ['commit', '-m', `remove: ${relativePath}`, `--author=${AUTHOR}`])
  if (commitCode !== 0) throw new Error(`git commit failed: remove ${relativePath}`)
}
