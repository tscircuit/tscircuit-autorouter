import { expect, test } from "bun:test"
import { prepareGeneratedForestBoundedRepairInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/prepareGeneratedForestBoundedRepairInput"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("a user preload retains the original bounded-repair exclusion regardless of its trace name", () => {
  const trace: SimplifiedPcbTrace = { type: "pcb_trace", pcb_trace_id: "pipeline9_forest_99", connection_name: "user", route: [
    { route_type: "wire", x: -2, y: 0, width: 0.15, layer: "top" }, { route_type: "wire", x: 2, y: 0, width: 0.15, layer: "top" },
  ] }
  const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.15, bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 }, obstacles: [], connections: [], traces: [trace] }
  const projected = prepareGeneratedForestBoundedRepairInput({ originalSrj: input, updatedPreloadedTraces: [trace], generatedFixedTraceIds: new Set(["different_explicit_owned_id"]),
    connMap: getConnectivityMapFromSimpleRouteJson(input), defaultViaDiameter: 0.3 })
  expect(projected.srj).toBe(input)
  expect(projected.srj.traces).toEqual([trace])
  let validations = 0
  const solver = new Pipeline9BoundedRegionalRepairSolver({ originalSrj: projected.srj, routes: [], syntheticConnectionNames: new Set(),
    drcEvaluator: () => { validations++; return [] } })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getResult().attemptedRegionCount).toBe(0)
  expect(validations).toBe(0)
})
