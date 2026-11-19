import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { FanoutSolver } from "./lib/fanout-solver"
import { validateRoutedCopperDrc } from "./lib/validate-routed-copper-drc"
import type { SimpleRouteJson } from "@tscircuit/capacity-autorouter"
import type { FanoutSolverOptions } from "./lib/types"

type CapturedFanout = {
  solverParams: SimpleRouteJson
  solverOptions: FanoutSolverOptions
}

const [inputPath, outputFolder] = process.argv.slice(2)
mkdirSync(outputFolder, { recursive: true })
const serialized = gunzipSync(readFileSync(inputPath)).toString()
const captured: CapturedFanout = JSON.parse(serialized)
if (captured.solverParams.traces?.length) {
  throw new Error("Native isolated-plane cohort requires fresh input without supplied traces")
}
const planeBuses = captured.solverOptions.buses!.filter(
  (bus) => bus.termination?.type === "plane",
)
const reports = []
for (const selectedBus of planeBuses) {
  const { solverParams, solverOptions }: CapturedFanout = JSON.parse(serialized)
  const selectedConnections = solverParams.connections.filter((connection) =>
    selectedBus.connectionNames.includes(connection.name),
  )
  if (selectedConnections.length !== selectedBus.connectionNames.length) {
    throw new Error(`Native plane bus has missing connections: ${selectedBus.busId}`)
  }
  solverParams.connections = selectedConnections
  solverParams.buses = [selectedBus]
  solverOptions.buses = [selectedBus]
  solverOptions.busDirections = {
    [selectedBus.busId]: captured.solverOptions.busDirections![selectedBus.busId]!,
  }
  const inputSha256 = createHash("sha256")
    .update(JSON.stringify({ solverParams, solverOptions }))
    .digest("hex")
  const started = performance.now()
  const solver = new FanoutSolver(solverParams, solverOptions)
  while (!solver.solved && !solver.failed && performance.now() - started < 10_000) {
    solver.step()
  }
  const elapsedMs = performance.now() - started
  const outputSrj = solver.solved ? solver.getOutputSimpleRouteJson() : null
  const copperDrc = outputSrj
    ? validateRoutedCopperDrc({
        inputSrj: captured.solverParams,
        routedSrj: outputSrj,
        clearance: solverParams.minViaEdgeToPadEdgeClearance,
        allowBlindAndBuriedVias: false,
      })
    : null
  const report = {
    busId: selectedBus.busId,
    connectionNames: selectedBus.connectionNames,
    inputSha256,
    obstacleCount: solverParams.obstacles.length,
    status: solver.solved ? "solved" : solver.failed ? "failed" : "timeout",
    elapsedMs,
    iterations: solver.iterations,
    error: solver.error,
    copperDrc,
    copperSha256: outputSrj
      ? createHash("sha256").update(JSON.stringify(outputSrj.traces)).digest("hex")
      : null,
  }
  reports.push(report)
  writeFileSync(`${outputFolder}/report.json`, JSON.stringify(reports, null, 2))
  console.log("ISOLATED_NATIVE_PLANE_CASE", JSON.stringify(report))
  if (copperDrc && !copperDrc.valid) {
    throw new Error(`Accepted native plane bus failed copper DRC: ${selectedBus.busId}`)
  }
}
console.log("ISOLATED_NATIVE_PLANE_SUMMARY", JSON.stringify({
  inputSha256: createHash("sha256").update(serialized).digest("hex"),
  cases: reports.length,
  outcomes: reports.reduce<Record<string, number>>((counts, report) => {
    counts[report.status] = (counts[report.status] ?? 0) + 1
    return counts
  }, {}),
  scope: "Each declared native plane bus solved separately with all original obstacles and physical rules; not a full-board solve.",
  caseBudgetMs: 10_000,
}))
