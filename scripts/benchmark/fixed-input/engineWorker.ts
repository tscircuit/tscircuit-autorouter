import { spawnSync } from "node:child_process"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { SimplifiedPcbTrace } from "../../../lib/types/srj-types"
import {
  createFreeroutingDsn,
  parseFreeroutingSession,
} from "./freeroutingAdapter"
import { loadFixedInput } from "./loadFixedInput"

export type FixedInputEngine = "native" | "freerouting"

export interface EngineResult {
  engine: FixedInputEngine
  status: "completed" | "solver_failed" | "failed"
  engineReportedSolved: boolean | null
  traces: SimplifiedPcbTrace[] | null
  error?: string
  configuration: Record<string, unknown>
}

const [engine, manifestPath, outputDirectory, javaPath, jarPath] =
  process.argv.slice(2)
if (engine !== "native" && engine !== "freerouting")
  throw new Error("Unknown benchmark engine")
const input = await loadFixedInput(manifestPath)
let result: EngineResult

if (engine === "native") {
  const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(
    "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
  )
  const configuration = {
    solver: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
    effort: 1,
    cacheProvider: null,
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input.srj, {
    effort: 1,
    cacheProvider: null,
  })
  let lastPhase = ""
  // Log transition observations before each step. These are wall-clock events,
  // not solver phase timers (which can exclude expensive constructors).
  while (!solver.solved && !solver.failed) {
    const phase = solver.getCurrentPhase()
    if (phase !== lastPhase) {
      console.log(
        JSON.stringify({
          event: "phase",
          phase,
          workerElapsedMs: performance.now(),
        }),
      )
      lastPhase = phase
    }
    solver.step()
  }
  result = solver.failed
    ? {
        engine,
        status: "solver_failed",
        engineReportedSolved: false,
        traces: null,
        error: String(solver.error),
        configuration,
      }
    : {
        engine,
        status: "completed",
        engineReportedSolved: true,
        traces: solver.getOutputSimpleRouteJson().traces!,
        configuration,
      }
} else {
  if (!javaPath || !jarPath)
    throw new Error("Freerouting requires explicit Java and JAR paths")
  const dsnPath = join(outputDirectory, "input.dsn")
  const sessionPath = join(outputDirectory, "output.ses")
  const userDataPath = join(outputDirectory, "freerouting-data")
  await mkdir(userDataPath, { recursive: true })
  await writeFile(dsnPath, createFreeroutingDsn(input.srj))
  const args = [
    "-Djava.awt.headless=true",
    "-jar",
    jarPath,
    "-de",
    dsnPath,
    "-do",
    sessionPath,
    `--user_data_path=${userDataPath}`,
    "-da",
    "--gui.enabled=false",
    "--router.max_passes=0",
    "--router.max_threads=1",
    "--router.optimizer.enabled=false",
    "--router.fanout.enabled=false",
    "--router.automatic_neckdown=false",
    "--router.copperToEdgeClearanceUm=150",
  ]
  const configuration = { version: "2.4.1", command: [javaPath, ...args] }
  console.log(JSON.stringify({ event: "configuration", ...configuration }))
  const routed = spawnSync(javaPath, args, { stdio: "inherit" })
  if (routed.error) throw routed.error
  if (routed.status !== 0) {
    result = {
      engine,
      status: "failed",
      engineReportedSolved: null,
      traces: null,
      error: `Freerouting exited with status ${routed.status}, signal ${routed.signal}`,
      configuration,
    }
  } else {
    // Successful process exit or a session file does not prove connectivity.
    // The shared scorer, run outside the routing budget, evaluates this output.
    const traces = parseFreeroutingSession(
      await readFile(sessionPath, "utf8"),
      input.srj,
    )
    result = {
      engine,
      status: "completed",
      engineReportedSolved: null,
      traces,
      configuration,
    }
  }
}

await writeFile(
  join(outputDirectory, "engine-result.json.tmp"),
  JSON.stringify(result, null, 2),
)
await rename(
  join(outputDirectory, "engine-result.json.tmp"),
  join(outputDirectory, "engine-result.json"),
)
