import fs from "node:fs"
import path from "node:path"
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../../..")
const datasetDirectory =
  process.env.ROUTING_DATASET_DIRECTORY ??
  path.resolve(here, "../work/recorded/inputs")
const outputVariant = process.env.ROUTING_OUTPUT_VARIANT ?? "tscircuit"
const outputDirectory = path.resolve(here, "../results", outputVariant)
const budgetMs = Number(process.env.ROUTING_BUDGET_MS ?? "60000")
const sampleArguments = process.argv.slice(2)
const samples = sampleArguments.length
  ? sampleArguments.map((sample) =>
      sample.endsWith(".json") ? sample : `${sample}.json`,
    )
  : fs
      .readdirSync(datasetDirectory)
      .filter((name) => /^sample\d+\.json$/.test(name))
      .sort()
fs.mkdirSync(outputDirectory, { recursive: true })

const provenance = {
  engine: "tscircuit",
  package: "@tscircuit/capacity-autorouter",
  packageVersion: "0.0.983",
  packageTarball:
    "https://registry.npmjs.org/@tscircuit/capacity-autorouter/-/capacity-autorouter-0.0.983.tgz",
  inspectedSource:
    "https://github.com/tscircuit/tscircuit-autorouter/tree/a032a1c4978b0656397e36ecac59b070e085d6ea",
  dataset:
    "https://github.com/tscircuit/dataset-srj18/tree/b38e23cb1941084d1f77c935699eff425a902db5",
  pipeline: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
  config: {
    effort: 1,
    cacheProvider: null,
    budgetMs,
    hardTimeoutMs: budgetMs + 500,
    runtimeNetworkAccess: false,
    concurrency: Number(process.env.ROUTING_CONCURRENCY ?? "1"),
    inputOverrides:
      process.env.ROUTING_BOARD_EDGE_CLEARANCE === undefined
        ? {}
        : {
            minBoardEdgeClearance: Number(
              process.env.ROUTING_BOARD_EDGE_CLEARANCE,
            ),
          },
  },
  nodeVersion: process.version,
}
fs.writeFileSync(
  path.join(here, `provenance-${outputVariant}.json`),
  JSON.stringify(provenance, null, 2),
)

async function runSample(sample) {
  const inputFilename = path.join(datasetDirectory, sample)
  const inputSrj = JSON.parse(fs.readFileSync(inputFilename, "utf8"))
  const outputFilename = path.join(outputDirectory, sample)
  const logFilename = path.join(
    outputDirectory,
    sample.replace(".json", ".log"),
  )
  const log = fs.createWriteStream(logFilename)
  const child = fork(
    path.join(here, "tscircuitWorker.mjs"),
    [inputFilename, String(budgetMs)],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  )
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  const launchedAt = performance.now()
  let lastCheckpoint = null
  let completeResult = null
  let hardTimeout = false
  const timeout = setTimeout(() => {
    hardTimeout = true
    child.kill("SIGKILL")
  }, budgetMs + 500)
  child.on("message", (message) => {
    if (message.type === "checkpoint") lastCheckpoint = message.result
    if (message.type === "complete") completeResult = message.result
  })
  const exit = await new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }))
    child.on("error", (error) => resolve({ error: error.message }))
  })
  clearTimeout(timeout)
  log.end()
  const observedElapsedMs = performance.now() - launchedAt
  const result = completeResult ??
    lastCheckpoint ?? {
      traces: [],
      solved: false,
      failed: false,
      error: null,
      elapsedMs: observedElapsedMs,
    }
  if (result.rawHighDensityRoutes?.length) {
    const partialDirectory = path.join(here, "partial-hd", outputVariant)
    fs.mkdirSync(partialDirectory, { recursive: true })
    fs.writeFileSync(
      path.join(partialDirectory, sample),
      JSON.stringify(
        {
          sample,
          phase: result.phase,
          status: completeResult?.status ?? "timeout",
          description:
            "Unstitched intra-node copper fragments, preserved for debugging and excluded from final SRJ traces and routing-success metrics",
          routes: result.rawHighDensityRoutes,
        },
        null,
        2,
      ),
    )
  }
  const status =
    completeResult?.status ?? (hardTimeout ? "timeout" : "process_error")
  const error = completeResult
    ? completeResult.error
    : hardTimeout
      ? "Child exceeded hard wall timeout; preserved last checkpoint"
      : (exit.error ??
        `Child exited without final result (code ${exit.code}, signal ${exit.signal})`)
  const output = {
    ...inputSrj,
    traces: result.traces,
    experiment: {
      ...provenance,
      ...result,
      traces: undefined,
      rawHighDensityRoutes: undefined,
      partialHighDensityRouteCount: result.rawHighDensityRoutes?.length ?? 0,
      partialHighDensityRoutesFile: result.rawHighDensityRoutes?.length
        ? `baseline/partial-hd/${outputVariant}/${sample}`
        : undefined,
      elapsedMs: completeResult ? result.elapsedMs : observedElapsedMs,
      lastCheckpointElapsedMs: completeResult ? undefined : result.elapsedMs,
      status,
      error,
      childExit: exit,
      observedElapsedMs,
      partial: status !== "solved",
      resultCompleteness: completeResult
        ? "final-worker-result"
        : lastCheckpoint
          ? "last-worker-checkpoint"
          : "no-worker-checkpoint",
    },
  }
  fs.writeFileSync(outputFilename, JSON.stringify(output, null, 2))
  console.log(
    JSON.stringify({
      sample,
      status,
      traces: output.traces.length,
      phase: result.phase,
      elapsedMs: result.elapsedMs,
      error,
    }),
  )
}

for (const sample of samples) await runSample(sample)
