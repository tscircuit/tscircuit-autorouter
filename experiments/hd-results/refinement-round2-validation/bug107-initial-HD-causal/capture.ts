import { readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"

const checkout = "/workspace/hd-refinements-2026-10-28/legalization-conservative-qa"
const output = "/workspace/hd-refinements-2026-10-28/artifacts/bug107-hd-capture"
const head = "2f77750b872ddfeae0026987de3bf01e253f9992"
const legalizerPath = join(checkout, "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal.ts")
const hdPath = join(checkout, "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver.ts")
const fixturePath = join(checkout, "fixtures/bug-reports/bugreport107-board-1726/bugreport107-board-1726.json")
const legalizerOriginal = readFileSync(legalizerPath, "utf8")
const hdOriginal = readFileSync(hdPath, "utf8")
const fixtureBytes = readFileSync(fixturePath)
const legalNeedle = "export const legalizeHighDensityRouteProposal = (params: PhysicalRouteLegalizationParams): PhysicalRouteLegalizationResult => {"
const hdNeedle = "  constructor(private readonly params: Pipeline9HighDensitySolverParams) {\n    super()"
if (legalizerOriginal.split(legalNeedle).length !== 2 || hdOriginal.split(hdNeedle).length !== 2) throw new Error("Unexpected capture source shape")
let legalLoaded = false, hdLoaded = false, entryCount = 0, resultCount = 0
const callbacks = globalThis as any
const sha = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex")
const undefinedPaths = (value: any): string[][] => {
  const paths: string[][] = []
  const visit = (entry: any, path: string[], ancestors: Set<object>): void => {
    if (entry === null || typeof entry !== "object") return
    if (ancestors.has(entry)) throw new Error("Cyclic capture value")
    ancestors.add(entry)
    for (const key of Object.keys(entry)) {
      if (entry[key] === undefined) paths.push([...path, key])
      else visit(entry[key], [...path, key], ancestors)
    }
    ancestors.delete(entry)
  }
  visit(value, [], new Set())
  return paths
}
const writePacked = (name: string, value: any): void => {
  const raw = JSON.stringify(value, (_key, entry): any => entry instanceof Map ? { __captureMapEntries: [...entry] } : entry)
  writeFileSync(join(output, name + ".json.gz"), gzipSync(raw))
}
const extent = (routes: any[], node: any): any => {
  const b = { minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2, minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2 }
  const outside: any[] = [], offInset: any[] = []
  for (const [ri, route] of routes.entries()) for (const [pi, point] of route.route.entries()) {
    const via = route.vias.some((v: any): boolean => Math.hypot(v.x - point.x, v.y - point.y) < 1e-9)
    const radius = via ? Math.max(route.viaDiameter / 2, (point.traceThickness ?? route.traceThickness) / 2) : (point.traceThickness ?? route.traceThickness) / 2
    const inset = Math.min(radius, node.width / 2, node.height / 2)
    const detail = { routeIndex: ri, pointIndex: pi, x: point.x, y: point.y, z: point.z, via, endpoint: pi === 0 || pi === route.route.length - 1, radius }
    if (point.x < b.minX - 1e-9 || point.x > b.maxX + 1e-9 || point.y < b.minY - 1e-9 || point.y > b.maxY + 1e-9) outside.push(detail)
    if (point.x < b.minX + inset - 1e-9 || point.x > b.maxX - inset + 1e-9 || point.y < b.minY + inset - 1e-9 || point.y > b.maxY - inset + 1e-9) offInset.push(detail)
  }
  return { bounds: b, outsideNodeCount: outside.length, outsideNode: outside, offInsetCount: offInset.length, offInset }
}
callbacks.__captureBug107Entry = (params: any): number => {
  const id = ++entryCount
  const prefix = `proposal-${String(id).padStart(4, "0")}`
  writePacked(prefix + ".params", params)
  const meta = { id, prefix, nodeId: params.node.capacityMeshNodeId, routeCount: params.routes.length, points: params.routes.reduce((n: number, r: any): number => n + r.route.length, 0), undefinedPaths: undefinedPaths(params), extent: extent(params.routes, params.node) }
  writePacked(prefix + ".metadata", meta)
  appendFileSync(join(output, "entries.ndjson"), JSON.stringify({ id, prefix, nodeId: meta.nodeId, routeCount: meta.routeCount, points: meta.points, outsideNodeCount: meta.extent.outsideNodeCount, offInsetCount: meta.extent.offInsetCount }) + "\n")
  return id
}
callbacks.__captureBug107Result = (id: number, params: any, result: any): void => {
  resultCount++
  const prefix = `proposal-${String(id).padStart(4, "0")}`
  writePacked(prefix + ".result", result)
  appendFileSync(join(output, "results.ndjson"), JSON.stringify({ id, prefix, nodeId: params.node.capacityMeshNodeId, status: result.status, iterations: result.iterations, overlapPairsBefore: result.overlapPairsBefore, overlapPairsAfter: result.overlapPairsAfter, holePairsBefore: result.holePairsBefore, holePairsAfter: result.holePairsAfter, extent: extent(result.routes, params.node) }) + "\n")
}
callbacks.__captureBug107HdInput = (params: any): void => {
  if (hdLoaded) throw new Error("Unexpected second full HD constructor")
  hdLoaded = true
  writePacked("full-hd-constructor-params", params)
  writePacked("full-hd-constructor-undefined-paths", undefinedPaths(params))
}
const legalTransformed = legalizerOriginal.replace(legalNeedle, "const capturedOriginalLegalizeHighDensityRouteProposal = (params: PhysicalRouteLegalizationParams): PhysicalRouteLegalizationResult => {") + `\nexport const legalizeHighDensityRouteProposal = (params: PhysicalRouteLegalizationParams): PhysicalRouteLegalizationResult => {\n  const captureId = (globalThis as any).__captureBug107Entry(params)\n  const result = capturedOriginalLegalizeHighDensityRouteProposal(params)\n  ;(globalThis as any).__captureBug107Result(captureId, params, result)\n  return result\n}\n`
const hdTransformed = hdOriginal.replace(hdNeedle, hdNeedle + "\n    ;(globalThis as any).__captureBug107HdInput(params)")
writeFileSync(join(output, "source-manifest.json"), JSON.stringify({ sourceHead: head, legalizerOriginalSha256: sha(legalizerOriginal), legalizerExecutedSha256: sha(legalTransformed), hdOriginalSha256: sha(hdOriginal), hdExecutedSha256: sha(hdTransformed), fixtureSha256: sha(fixtureBytes), legalizerChange: "Rename original export to private exact original body; export wrapper calls original exactly once with same params and returns same result; write-only callbacks before and after.", hdChange: "Write-only capture callback after super() before parameter use.", timingComparisonValid: false }, null, 2))
Bun.plugin({ name: "observe-bug107-initial-HD-geometry", setup(builder): void {
  builder.onLoad({ filter: /legalizeHighDensityRouteProposal\.ts$/ }, (args): { contents: string; loader: "ts" } => {
    if (args.path !== legalizerPath || legalLoaded) throw new Error("Unexpected legalizer module load")
    legalLoaded = true
    return { contents: legalTransformed, loader: "ts" }
  })
  builder.onLoad({ filter: /Pipeline9HighDensitySolver\.ts$/ }, (args): { contents: string; loader: "ts" } => {
    if (args.path !== hdPath) throw new Error("Unexpected full HD module load")
    return { contents: hdTransformed, loader: "ts" }
  })
} })
const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(join(checkout, "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts"))
const srj = JSON.parse(fixtureBytes.toString()).simple_route_json
writePacked("input-srj", srj)
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj))
let stepCalls = 0
while (!solver.solved && !solver.failed) {
  solver.step(); stepCalls++
  if (solver.highDensityRouteSolver?.solved) {
    const hd = solver.highDensityRouteSolver
    writePacked("initial-hd-output", hd.routes)
    writePacked("pipeline-context", { originalSrj: solver.originalSrj, srjWithPointPairs: solver.srjWithPointPairs, newConnections: solver.netToPointPairsSolver!.newConnections, connMapNetMap: solver.connMap.netMap, nodes: solver.highDensityNodePortPoints, hdStats: hd.stats })
    if (readFileSync(legalizerPath, "utf8") !== legalizerOriginal || readFileSync(hdPath, "utf8") !== hdOriginal || !readFileSync(fixturePath).equals(fixtureBytes)) throw new Error("Original source or input changed")
    writeFileSync(join(output, "completion.json"), JSON.stringify({ status: "captured-initial-HD-only", sourceHead: head, finalSolveClaim: false, stoppedBeforeJointRepair: true, pipelineSolved: solver.solved, pipelineFailed: solver.failed, phase: solver.getCurrentPhase(), stepCalls, legalizerEntries: entryCount, legalizerResults: resultCount, legalLoaded, hdConstructorCaptured: hdLoaded, originalSourceAndInputUnchanged: true, timingComparisonValid: false }, null, 2))
    console.log(`Captured initial HD and ${entryCount}/${resultCount} legalizer proposals; intentional early stop before downstream repair.`)
    process.exit(0)
  }
}
throw new Error(`Pipeline terminated before initial HD capture: solved=${solver.solved} failed=${solver.failed} error=${solver.error}`)
