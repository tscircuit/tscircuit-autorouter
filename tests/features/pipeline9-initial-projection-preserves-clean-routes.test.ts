import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadPipeline9JointDrcInput } from "../fixtures/loadPipeline9JointDrcInput"

test("initial projection repairs via clearance without moving distant clean routes", (): void => {
  // Public SRJ33 sample 13: global smoothing cleared both via-pad contacts
  // but introduced distant pad contacts on two previously clean routes.
  const params = loadPipeline9JointDrcInput(
    `${import.meta.dir}/../fixtures/pipeline9-initial-projection-clean-route-collision.json.gz`,
  )
  const original = structuredClone(params.newHdRoutes)
  const canonical = canonicalizePipeline9HdRoutes(original)
  const convertOptions = {
    connections: params.newConnections,
    originalConnections: params.originalSrj.connections,
    layerCount: params.layerCount,
    obstacles: params.obstacles,
    defaultViaHoleDiameter: params.defaultViaHoleDiameter,
    connMap: params.connMap,
  }
  const initial = evaluateRelaxedDrc({
    inputSrj: params.originalSrj,
    srjWithPointPairs: params.srjWithPointPairs,
    routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...convertOptions,
      hdRoutes: original,
    }),
  })
  expect(initial.errors).toHaveLength(5)
  expect(
    initial.errors.filter(
      (error) => error.type === "pcb_pad_pad_clearance_error",
    ),
  ).toHaveLength(2)
  const distantCleanRoutes = new Set([
    "source_trace_99",
    "source_trace_81__source_trace_83_mst0",
  ])
  const solver = new Pipeline9JointDrcRepairSolver(params)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.initialBoundedRegionalRepairAccepted).toBeTrue()
  expect(solver.stats.initialBoundedRegionalRepairPathSearchNodeCount).toBe(0)
  expect(solver.exactRepairSolver).toBeUndefined()
  const routes = solver.getOutput()
  expect(routes).toHaveLength(original.length)
  for (const [index, route] of routes.entries()) {
    const inputRoute = original[index]!
    expect(route.route[0]).toEqual(inputRoute.route[0])
    expect(route.route.at(-1)).toEqual(inputRoute.route.at(-1))
    expect(route.traceThickness).toBe(inputRoute.traceThickness)
    expect(route.viaDiameter).toBe(inputRoute.viaDiameter)
    expect(route.vias).toHaveLength(inputRoute.vias.length)
    if (distantCleanRoutes.has(route.connectionName)) {
      expect(route).toEqual(canonical[index]!)
    }
  }
  const validation = evaluateRelaxedDrc({
    inputSrj: params.originalSrj,
    srjWithPointPairs: params.srjWithPointPairs,
    routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...convertOptions,
      hdRoutes: routes,
    }),
  })
  expect(validation.errors).toHaveLength(0)
  expect(params.newHdRoutes).toEqual(original)
})
