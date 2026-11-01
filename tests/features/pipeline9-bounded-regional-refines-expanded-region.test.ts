import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadPipeline9JointDrcInput } from "../fixtures/loadPipeline9JointDrcInput"

test("expanding a stalled region refines a narrow detour within its existing allowance", (): void => {
  // Captured on Linux from public SRJ33 sample 26. Projection and the first
  // coarse region leave one crossing; repeating the coarse grid cannot clear
  // it and forces the nearly clean board to be discarded.
  const params = loadPipeline9JointDrcInput(
    `${import.meta.dir}/../fixtures/pipeline9-srj33-sample26-linux-residue.json.gz`,
  )
  const original = structuredClone(params.newHdRoutes)
  const solver = new Pipeline9JointDrcRepairSolver(params)
  expect(solver.stats.initialJointDrcIssueCount).toBe(186)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.initialBoundedRegionalRepairAccepted).toBeTrue()
  expect(solver.exactRepairSolver).toBeUndefined()
  expect(solver.regionalB01RepairSolver).toBeUndefined()
  const result = solver.initialBoundedRegionalRepairSolver!.getResult()
  expect(result.repaired).toBeTrue()
  expect(result.publishedDrcIssueCount).toBe(0)
  // The failed coarse-only solve already used this many search calls.
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(1536)
  expect(result.pathSearchNodeCount).toBeLessThanOrEqual(4_000_000)
  expect(result.attemptedRegionCount).toBeLessThanOrEqual(3)
  const routes = solver.getOutput()
  expect(routes).toHaveLength(original.length)
  for (const [index, route] of routes.entries()) {
    expect(route.route[0]).toEqual(original[index]!.route[0])
    expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
    expect(route.traceThickness).toBe(original[index]!.traceThickness)
    expect(route.viaDiameter).toBe(original[index]!.viaDiameter)
    expect(route.connectionName).toBe(original[index]!.connectionName)
  }
  expect(
    routes.reduce((count, route): number => count + route.vias.length, 0),
  ).toBeLessThanOrEqual(
    original.reduce((count, route): number => count + route.vias.length, 0),
  )
  const { errors } = evaluateRelaxedDrc({
    inputSrj: params.originalSrj,
    srjWithPointPairs: params.srjWithPointPairs,
    routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: params.newConnections,
      originalConnections: params.originalSrj.connections,
      hdRoutes: routes,
      layerCount: params.layerCount,
      obstacles: params.obstacles,
      defaultViaHoleDiameter: params.defaultViaHoleDiameter,
      connMap: params.connMap,
    }),
  })
  expect(errors).toHaveLength(0)
  expect(params.newHdRoutes).toEqual(original)
})
