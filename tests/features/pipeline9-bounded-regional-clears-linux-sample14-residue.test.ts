import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadPipeline9JointDrcInput } from "../fixtures/loadPipeline9JointDrcInput"

test("bounded repair clears the Linux sample 14 residue without restarting broad repair", (): void => {
  // Captured after three accepted regional repairs on the public SRJ18
  // OV9281 board. Refining the search grid at four errors exhausted the
  // remaining allowance and sent the original board through broad repair.
  const params = loadPipeline9JointDrcInput(
    `${import.meta.dir}/../fixtures/pipeline9-srj18-sample14-linux-residue.json.gz`,
  )
  const original = structuredClone(params.newHdRoutes)
  const solver = new Pipeline9JointDrcRepairSolver(params)
  expect(solver.stats.initialJointDrcIssueCount).toBe(4)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.initialBoundedRegionalRepairAccepted).toBeTrue()
  expect(solver.stats.initialBoundedRegionalRepairPublishedDrcIssueCount).toBe(0)
  expect(solver.exactRepairSolver).toBeUndefined()
  expect(solver.regionalB01RepairSolver).toBeUndefined()
  const bounded = solver.initialBoundedRegionalRepairSolver!
  expect(bounded.getResult().pathSearchNodeCount).toBeLessThanOrEqual(
    bounded.budget.initialMaxPathSearchNodes!,
  )
  const routes = solver.getOutput()
  expect(routes).toHaveLength(original.length)
  for (const [index, route] of routes.entries()) {
    expect(route.route[0]).toEqual(original[index]!.route[0])
    expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
    expect(route.traceThickness).toBe(original[index]!.traceThickness)
    expect(route.connectionName).toBe(original[index]!.connectionName)
  }
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
