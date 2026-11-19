import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [id, outputPath] = process.argv.slice(2)
const output = resolve(outputPath)
mkdirSync(output, { recursive: true })
const log = openSync(join(output, "worker.log"), "w")
const started = performance.now()
const child = Bun.spawn([process.execPath, "render.tsx", id, output, "fanout"], {
  cwd: import.meta.dir,
  env: process.env,
  stdout: log,
  stderr: log,
})
let timedOut = false
const timer = setTimeout(() => {
  timedOut = true
  child.kill("SIGKILL")
}, 660_000)
const exitCode = await child.exited
clearTimeout(timer)
closeSync(log)
writeFileSync(join(output, "process.json"), JSON.stringify({
  id,
  mode: "fanout-bus-first",
  exitCode,
  timedOut,
  wallMs: performance.now() - started,
  routingBudgetMs: 600_000,
  hardProcessBudgetMs: 660_000,
  concurrency: 1,
}, null, 2))
if (exitCode !== 0 && !timedOut) {
  throw new Error(`Full-board render process failed: ${id}, exit ${exitCode}`)
}
const audit = Bun.spawn([process.execPath, "assess.ts", id, output], {
  cwd: import.meta.dir,
  env: process.env,
  stdout: "inherit",
  stderr: "inherit",
})
const auditTimer = setTimeout(() => audit.kill("SIGKILL"), 180_000)
const auditExitCode = await audit.exited
clearTimeout(auditTimer)
if (auditExitCode !== 0) throw new Error(`Full-board physical audit failed: ${id}`)
