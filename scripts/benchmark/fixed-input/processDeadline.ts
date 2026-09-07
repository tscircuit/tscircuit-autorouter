import { spawn } from "node:child_process"
import { open } from "node:fs/promises"

export interface ProcessDeadlineOptions {
  command: string[]
  cwd: string
  budgetMs: number
  logPath: string
  env?: NodeJS.ProcessEnv
}

export interface ProcessDeadlineResult {
  status: "exited" | "timed_out"
  exitCode: number | null
  signal: NodeJS.Signals | null
  elapsedMs: number
  budgetMs: number
}

/**
 * A parent-process monotonic deadline includes process startup and synchronous
 * constructor/step work. Kill the POSIX process group, including nested Java.
 */
export const runProcessWithDeadline = async (
  options: ProcessDeadlineOptions,
): Promise<ProcessDeadlineResult> => {
  if (!Number.isFinite(options.budgetMs) || options.budgetMs <= 0) {
    throw new Error("budgetMs must be positive and finite")
  }
  if (process.platform === "win32") throw new Error("Fixed-input benchmarks require POSIX process groups")
  const log = await open(options.logPath, "wx")
  const start = performance.now()
  const child = spawn(options.command[0], options.command.slice(1), {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  })
  let didTimeout = false
  const timer = setTimeout(() => {
    didTimeout = true
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      }
    }
  }, Math.max(1, options.budgetMs - (performance.now() - start)))
  try {
    const termination = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (exitCode, signal) => resolve({ exitCode, signal }))
    })
    const elapsedMs = performance.now() - start
    return {
      status: didTimeout || elapsedMs > options.budgetMs ? "timed_out" : "exited",
      ...termination,
      elapsedMs,
      budgetMs: options.budgetMs,
    }
  } finally {
    clearTimeout(timer)
    await log.close()
  }
}
