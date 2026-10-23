import { checkDanglingTraces, checkTracesAreContiguous } from "@tscircuit/checks"
import { convertToCircuitJson } from "../../lib/testing/utils/convertToCircuitJson"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import srj from "../../fixtures/legacy/assets/e2e4.json"

test("ordinary P9 fixture exercises physical cut constraints and retains final copper/connectivity quality", () => {
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj) as SimpleRouteJson)
  while (!pipeline.failed && !pipeline.portPointPathingSolver?.solved) pipeline.step()
  expect(pipeline.failed).toBe(false)
  const phase = pipeline.portPointPathingSolver!
  const stats = phase.stats
  expect(stats.physicalCutAnnotationPasses).toBe(2)
  expect(stats.physicalCutTaggedGroups).toBeGreaterThan(0)
  expect(stats.physicalCutOwnerChecks).toBeGreaterThan(0)
  expect(phase.getOutput().nodesWithPortPoints.length).toBeGreaterThan(0)
  for (const [key, value] of Object.entries(stats)) if (key.startsWith("physicalCut")) expect(Number.isFinite(value)).toBe(true)
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  expect(pipeline.failed).toBe(false)
  const circuitJson = convertToCircuitJson(pipeline.srjWithPointPairs!, pipeline.getOutputSimplifiedPcbTraces(), { originalSrj: srj as SimpleRouteJson, includeOriginalConnections: true })
  // This legacy SRJ has no pcb_port_id metadata. The dangling checker labels
  // its requested endpoints too; reject any dangling point beyond those ends.
  const sourceSrj = srj as SimpleRouteJson
  const requested = sourceSrj.connections.flatMap((connection) => connection.pointsToConnect)
  const dangling = checkDanglingTraces(circuitJson)
  for (const error of dangling) expect(requested.some((p) => Math.hypot(p.x - error.center!.x, p.y - error.center!.y) < 1e-6)).toBe(true)
  for (const error of checkTracesAreContiguous(circuitJson)) expect(requested.some((p) => Math.hypot(p.x - error.center!.x, p.y - error.center!.y) < 1e-6)).toBe(true)
  const finalRoutes = pipeline._getOutputHdRoutes()
  for (const connection of sourceSrj.connections) {
    const routes = finalRoutes.filter((route) => (route.rootConnectionName ?? route.connectionName).startsWith(connection.name))
    expect(routes.length).toBeGreaterThan(0)
    for (const endpoint of connection.pointsToConnect) expect(routes.some((route) => [route.route[0]!, route.route.at(-1)!].some((point) => Math.hypot(point.x - endpoint.x, point.y - endpoint.y) < 1e-6))).toBe(true)
  }
  expect(getDrcErrors(circuitJson, { includeTraceContinuity: false }).errors).toEqual([])
  console.log("existing-fixture physical cut scope", Object.fromEntries(Object.entries(stats).filter(([key]) => key.startsWith("physicalCut"))))
})
