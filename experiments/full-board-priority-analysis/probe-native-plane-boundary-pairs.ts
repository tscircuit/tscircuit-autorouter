import type { SimpleRouteJson } from "@tscircuit/capacity-autorouter"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { gunzipSync, gzipSync } from "node:zlib"
import { FanoutSolver } from "./lib/fanout-solver"
import type { AssignmentAttempt, FanoutSolverOptions } from "./lib/types"
import { validateRoutedCopperDrc } from "./lib/validate-routed-copper-drc"

interface CapturedFanout {
  solverParams: SimpleRouteJson
  solverOptions: FanoutSolverOptions
}

const [inputPath, outputFolder] = process.argv.slice(2)
if (!inputPath || !outputFolder)
  throw new Error("Usage: bun probe-native-plane-boundary-pairs.ts input.json.gz output-folder")
const originalBytes = readFileSync(inputPath)
const serialized = gunzipSync(originalBytes).toString()
const original: CapturedFanout = JSON.parse(serialized)
const inputSha256 = createHash("sha256").update(serialized).digest("hex")
const budgetMs = Number(process.env.PAIR_PROBE_CASE_BUDGET_MS ?? 10_000)
const variant = process.env.PAIR_PROBE_VARIANT ?? "unspecified"
if (!Number.isFinite(budgetMs) || budgetMs <= 0)
  throw new Error("PAIR_PROBE_CASE_BUDGET_MS must be positive")
if (original.solverParams.traces?.length)
  throw new Error("Pair probe requires fresh native input without supplied routes")
mkdirSync(outputFolder, { recursive: true })
writeFileSync(`${outputFolder}/original-input.json.gz`, originalBytes)

function isolateConnections(names: readonly string[]): CapturedFanout {
  const selected = new Set(names)
  const captured: CapturedFanout = JSON.parse(serialized)
  captured.solverParams.connections = captured.solverParams.connections.filter(
    (connection) => selected.has(connection.name),
  )
  captured.solverOptions.buses = (captured.solverOptions.buses ?? []).filter(
    (bus) => bus.connectionNames.every((name) => selected.has(name)),
  )
  if (captured.solverParams.connections.length !== names.length)
    throw new Error("Native pair did not retain exactly the requested connections")
  return captured
}

function routeCapture(params: {
  captured: CapturedFanout
  folder: string
}) {
  const { captured, folder } = params
  mkdirSync(folder, { recursive: true })
  const caseSerialized = JSON.stringify(captured)
  writeFileSync(`${folder}/input.json.gz`, gzipSync(caseSerialized))
  const started = performance.now()
  const solver = new FanoutSolver(captured.solverParams, captured.solverOptions)
  while (!solver.solved && !solver.failed && performance.now() - started < budgetMs)
    solver.step()
  const elapsedMs = performance.now() - started
  const bestAttempt = Reflect.get(solver, "bestAttempt") as AssignmentAttempt | null
  const output = solver.solved ? solver.getOutput() : undefined
  const routedSrj = output?.simpleRouteJson ?? bestAttempt?.outputSrj
  const copperDrc = routedSrj
    ? validateRoutedCopperDrc({
        inputSrj: original.solverParams,
        routedSrj,
        clearance: solver.config.clearance,
        allowBlindAndBuriedVias: solver.config.allowBlindAndBuriedVias,
      })
    : null
  const report = {
    variant,
    inputSha256,
    caseSha256: createHash("sha256").update(caseSerialized).digest("hex"),
    connectionNames: captured.solverParams.connections.map((connection) => connection.name),
    originalObstacleCount: original.solverParams.obstacles.length,
    retainedObstacleCount: captured.solverParams.obstacles.length,
    budgetMs,
    elapsedMs,
    status: solver.solved ? "solved" : solver.failed ? "failed" : "timeout",
    routed: bestAttempt?.plans.length ?? 0,
    requested: captured.solverParams.connections.length,
    iterations: solver.iterations,
    error: solver.error,
    copperDrc,
    validation: output?.validation ?? null,
    busLayerAssignments:
      output?.busLayerAssignments ?? bestAttempt?.summary?.busLayerAssignments,
  }
  const graphics = solver.visualize()
  writeFileSync(`${folder}/report.json`, JSON.stringify(report, null, 2))
  writeFileSync(`${folder}/graphics.json.gz`, gzipSync(JSON.stringify(graphics)))
  writeFileSync(`${folder}/fanout.svg`, getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white", svgWidth: 1100, svgHeight: 1000,
  }))
  writeFileSync(`${folder}/traces.json`, JSON.stringify(routedSrj?.traces ?? [], null, 2))
  if (copperDrc && !copperDrc.valid)
    throw new Error(`Native pair emitted invalid copper: ${report.connectionNames.join(", ")}`)
  return report
}

const declaredBuses = original.solverOptions.buses ?? []
const declaredConnections = new Set(declaredBuses.flatMap((bus) => bus.connectionNames))
const unclaimedBoundaries = original.solverParams.connections.filter(
  (connection) => !declaredConnections.has(connection.name),
)
const boundaryReports = unclaimedBoundaries.map((connection) =>
  routeCapture({
    captured: isolateConnections([connection.name]),
    folder: `${outputFolder}/individual/${createHash("sha256").update(connection.name).digest("hex").slice(0, 12)}`,
  }),
)
writeFileSync(`${outputFolder}/individual-boundaries.json`, JSON.stringify(boundaryReports, null, 2))
const solvableBoundaries = boundaryReports.filter((report) => report.status === "solved")
const singletonPlanes = declaredBuses.filter(
  (bus) => bus.termination?.type === "plane" && bus.connectionNames.length === 1,
)
const reports = []
for (const plane of singletonPlanes) {
  for (const boundary of solvableBoundaries) {
    const names = [...plane.connectionNames, ...boundary.connectionNames]
    const pairId = createHash("sha256").update(JSON.stringify(names)).digest("hex").slice(0, 16)
    const report = {
      pairId,
      planeBusId: plane.busId,
      boundaryConnectionName: boundary.connectionNames[0],
      ...routeCapture({ captured: isolateConnections(names), folder: `${outputFolder}/pairs/${pairId}` }),
    }
    reports.push(report)
    writeFileSync(`${outputFolder}/pairs.json`, JSON.stringify(reports, null, 2))
    console.log("NATIVE_PAIR_PROBE_CASE", JSON.stringify(report))
  }
}
const summary = {
  variant,
  inputSha256,
  unclaimedBoundaryCount: unclaimedBoundaries.length,
  individuallySolvableBoundaryNames: solvableBoundaries.flatMap((report) => report.connectionNames),
  singletonPlaneCount: singletonPlanes.length,
  pairCount: reports.length,
  solvedPairs: reports.filter((report) => report.status === "solved").length,
  timedOutPairs: reports.filter((report) => report.status === "timeout").length,
  scope: "Only original connections and declared solverOptions.buses are filtered. Every original obstacle, design rule, direction, exit and layer hint is retained. These are native two-request cuts, not full-board solves.",
}
writeFileSync(`${outputFolder}/summary.json`, JSON.stringify(summary, null, 2))
console.log("NATIVE_PAIR_PROBE_SUMMARY", JSON.stringify({ ...summary, reports }))
