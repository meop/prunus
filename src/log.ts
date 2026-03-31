import { settings } from './settings.ts'

type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const minLevel = (settings.log?.level ?? 'info') as Level

function write(level: Level, scope: string, message: string, data?: unknown): void {
  if (ORDER[level] < ORDER[minLevel]) return
  const tag = level.toUpperCase().padEnd(5)
  const parts = [new Date().toISOString(), `[${tag}]`, scope.padEnd(8), message]
  if (data !== undefined) parts.push(JSON.stringify(data))
  const line = parts.join(' ')
  if (level === 'error' || level === 'warn') {
    console.error(line)
  } else {
    console.log(line)
  }
}

export const log = {
  debug: (scope: string, msg: string, data?: unknown) => write('debug', scope, msg, data),
  info: (scope: string, msg: string, data?: unknown) => write('info', scope, msg, data),
  warn: (scope: string, msg: string, data?: unknown) => write('warn', scope, msg, data),
  error: (scope: string, msg: string, data?: unknown) => write('error', scope, msg, data),
}
