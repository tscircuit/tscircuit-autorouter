import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson } from "../lib/types"

type FixtureName = "input" | "captured-output"

export function loadMotherboardPowerPhase(name: FixtureName = "input"): SimpleRouteJson {
  const path = new URL(`../tests/fixtures/bug-reports/motherboard-power-phase/${name}.srj.json.gz`, import.meta.url)
  const bytes = gunzipSync(readFileSync(path))
  const expected = name === "input"
    ? "fe668fa67c67bad115236aa21ab18cb0f7853b2b49da7b0131218a807f7043fb"
    : "12bb1ad7a4bd94e0aaaa60d458dc6dd489ff1df1f1db694a5f718233c3de39b0"
  if (createHash("sha256").update(bytes).digest("hex") !== expected) {
    throw new Error(`Power phase ${name} fixture hash mismatch`)
  }
  return JSON.parse(bytes.toString()) as SimpleRouteJson
}

async function main(): Promise<void> {
  if (process.argv.includes("--inspect")) {
    const input = loadMotherboardPowerPhase()
    const captured = loadMotherboardPowerPhase("captured-output")
    console.log(JSON.stringify({ connections: input.connections.length, obstacles: input.obstacles.length, preloadedTraces: input.traces?.length, capturedOutputTraces: captured.traces?.length, bounds: input.bounds, layerCount: input.layerCount }, null, 2))
    return
  }
  if (!process.argv.includes("--child")) {
    const seconds = Number(process.env.TIMEOUT_SECONDS ?? 120)
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("TIMEOUT_SECONDS must be positive")
    // Keep the watchdog outside the solver event loop: synchronous stages can block timers.
    const child = Bun.spawn([process.execPath, import.meta.path, "--child"], { stdout: "inherit", stderr: "inherit", env: process.env })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      console.log(JSON.stringify({ event: "timeout", seconds }))
      child.kill("SIGKILL")
    }, seconds * 1000)
    const code = await child.exited
    clearTimeout(timer)
    process.exitCode = timedOut ? 124 : code
    return
  }
  const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import("../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph")
  const { createAutorouterSolverRuntime } = await import("../lib/runtime/bun")
  const input = loadMotherboardPowerPhase()
  const start = performance.now()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { effort: 1, cacheProvider: null })
  const runtime = createAutorouterSolverRuntime({ workerCount: 2, requireWorker: true })
  const report = (): void => {
    console.log(JSON.stringify({ elapsedSeconds: (performance.now() - start) / 1000, phase: solver.getCurrentPhase(), progress: solver.progress, iterations: solver.iterations, solved: solver.solved, failed: solver.failed, error: solver.error }))
  }
  console.log(JSON.stringify({ event: "start", bun: Bun.version, platform: process.platform, arch: process.arch, connections: input.connections.length, obstacles: input.obstacles.length, preloadedTraces: input.traces?.length, workerCount: 2, effort: 1 }))
  const timer = setInterval(report, 5000)
  const previewTimer = process.env.DEBUG_PREVIEW === "1" ? setInterval(() => { solver.preview() }, 250) : undefined
  try {
    await solver.solveAsync(runtime)
    report()
    if (solver.failed || !solver.solved) process.exitCode = 1
    else writeFileSync(process.env.OUTPUT_PATH ?? "/tmp/motherboard-power-phase-output.srj.json", JSON.stringify(solver.getOutputSimpleRouteJson(), null, 2))
  } finally {
    clearInterval(timer)
    if (previewTimer) clearInterval(previewTimer)
    await runtime.dispose()
  }
}

if (import.meta.main) await main()
