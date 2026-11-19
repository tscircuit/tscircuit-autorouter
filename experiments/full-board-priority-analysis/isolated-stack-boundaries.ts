import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { gunzipSync, gzipSync } from "node:zlib"
import type { SimpleRouteJson } from "@tscircuit/capacity-autorouter"
import { FanoutSolver } from "./lib/fanout-solver"
import type { FanoutSolverOptions } from "./lib/types"
import { validateRoutedCopperDrc } from "./lib/validate-routed-copper-drc"

type CapturedFanout = {
  solverParams: SimpleRouteJson
  solverOptions: FanoutSolverOptions
}

const [inputPath, outputFolder] = process.argv.slice(2)
if (!inputPath || !outputFolder) {
  throw new Error("Usage: bun isolated-boundary-suite.ts input.json.gz output-folder")
}
mkdirSync(outputFolder, { recursive: true })
const serialized = gunzipSync(readFileSync(inputPath)).toString()
const captured: CapturedFanout = JSON.parse(serialized)
if (captured.solverParams.traces?.length) {
  throw new Error("Native boundary cohort requires fresh input without supplied traces")
}
// These requests become ordinary singleton buses in the original workflow.
// Preserve every declared bus by excluding its connections from this cohort.
const declaredConnections = new Set(
  (captured.solverOptions.buses ?? captured.solverParams.buses ?? []).flatMap(
    (bus) => bus.connectionNames,
  ),
)
const nativeConnections = captured.solverParams.connections.filter(
  (connection) => !declaredConnections.has(connection.name),
)
const reports = []
const acceptedOutputs = []
for (const selectedConnection of nativeConnections) {
  const { solverParams, solverOptions }: CapturedFanout = JSON.parse(serialized)
  solverParams.connections = solverParams.connections.filter(
    (connection) => connection.name === selectedConnection.name,
  )
  if (solverParams.connections.length !== 1) {
    throw new Error(`Native boundary connection is not unique: ${selectedConnection.name}`)
  }
  solverParams.buses = []
  solverOptions.buses = []
  // No synthetic direction, preferred exit, fixed via, or layer guidance.
  const inputSha256 = createHash("sha256")
    .update(JSON.stringify({ solverParams, solverOptions }))
    .digest("hex")
  const started = performance.now()
  const solver = new FanoutSolver(solverParams, solverOptions)
  while (!solver.solved && !solver.failed && performance.now() - started < 10_000) {
    solver.step()
  }
  const elapsedMs = performance.now() - started
  const output = solver.solved ? solver.getOutput() : null
  const copperDrc = output
    ? validateRoutedCopperDrc({
        inputSrj: captured.solverParams,
        routedSrj: output.simpleRouteJson,
        clearance:
          solverOptions.clearance ??
          solverParams.minViaEdgeToPadEdgeClearance ??
          solverParams.minTraceToPadEdgeClearance ??
          solverParams.defaultObstacleMargin ??
          solverParams.minTraceWidth,
        allowBlindAndBuriedVias:
          solverOptions.allowBlindAndBuriedVias ?? true,
      })
    : null
  const report = {
    connectionName: selectedConnection.name,
    inputSha256,
    obstacleCount: solverParams.obstacles.length,
    inferredDirection: solver.preparedBuses[0]?.direction,
    status: solver.solved ? "solved" : solver.failed ? "failed" : "timeout",
    elapsedMs,
    iterations: solver.iterations,
    error: solver.error,
    validation: output?.validation ?? null,
    copperDrc,
    viaCount: copperDrc?.checkedViaCount ?? null,
    distinctDrills: output
      ? new Set(output.simpleRouteJson.traces.flatMap((trace) => trace.route.filter((point) => point.route_type === "via").map((point) => `${point.x},${point.y}`))).size
      : null,
    copperSha256: output
      ? createHash("sha256")
          .update(JSON.stringify(output.simpleRouteJson.traces))
          .digest("hex")
      : null,
  }
  reports.push(report)
  if (output) {
    // Preserve actual accepted copper and endpoint changes without duplicating
    // the full original obstacle field hundreds of times in the artifact.
    acceptedOutputs.push({
      connectionName: selectedConnection.name,
      inputSha256,
      fanoutTraces: output.fanoutTraces,
      completionTraces: output.completionTraces,
      connections: output.simpleRouteJson.connections,
      validation: output.validation,
      busDirections: output.busDirections,
      busLayerAssignments: output.busLayerAssignments,
      planeTerminations: output.planeTerminations,
    })
  }
  writeFileSync(`${outputFolder}/report.json`, JSON.stringify(reports, null, 2))
  writeFileSync(
    `${outputFolder}/accepted-output.json.gz`,
    gzipSync(JSON.stringify(acceptedOutputs)),
  )
  console.log("ISOLATED_NATIVE_BOUNDARY_CASE", JSON.stringify(report))
  if (copperDrc && !copperDrc.valid) {
    throw new Error(`Accepted native boundary connection failed copper DRC: ${selectedConnection.name}`)
  }
}
const summary = {
  inputSha256: createHash("sha256").update(serialized).digest("hex"),
  cases: reports.length,
  outcomes: reports.reduce<Record<string, number>>((counts, report) => {
    counts[report.status] = (counts[report.status] ?? 0) + 1
    return counts
  }, {}),
  acceptedVias: reports.reduce((sum, report) => sum + (report.viaCount ?? 0), 0),
  scope: "Each original unclaimed boundary connection solved separately with every original obstacle and physical rule, no new bus guidance; not a joint fanout or full-board solve.",
  caseBudgetMs: 10_000,
}
writeFileSync(`${outputFolder}/summary.json`, JSON.stringify(summary, null, 2))
console.log("ISOLATED_NATIVE_BOUNDARY_SUMMARY", JSON.stringify(summary))
