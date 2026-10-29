import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadPipeline9JointDrcInput } from "../fixtures/loadPipeline9JointDrcInput"

// The supplied board stays outside the public repository. Point this opt-in
// reproduction at its debugger export to repeat validation locally.
const inputPath = process.env.PIPELINE9_JOINT_DRC_INPUT
test.skipIf(!inputPath)(
  "joint DRC repair clears the exported 244-route input deterministically before portfolio search",
  (): void => {
    const params = loadPipeline9JointDrcInput(inputPath!)
    const originalRoutes = structuredClone(params.newHdRoutes)
    const solver = new Pipeline9JointDrcRepairSolver(params)
    let previousProgress = 0
    while (!solver.solved && !solver.failed) {
      solver.step()
      expect(solver.progress).toBeGreaterThanOrEqual(previousProgress)
      previousProgress = solver.progress
    }
    expect(solver.failed, solver.error ?? "").toBeFalse()
    expect(solver.solved).toBeTrue()
    expect(solver.activeSubSolver).toBeNull()
    expect(solver.stats.initialJointDrcIssueCount).toBe(71)
    expect(solver.stats.initialBoundedRegionalRepairAccepted).toBeTrue()
    expect(
      solver.stats.initialBoundedRegionalRepairPublishedDrcIssueCount,
    ).toBe(0)
    expect(solver.exactRepairSolver).toBeUndefined()
    expect(solver.regionalB01RepairSolver).toBeUndefined()
    const routes = solver.getOutput()
    expect(routes).toHaveLength(244)
    for (const [index, route] of routes.entries()) {
      const original = originalRoutes[index]!
      expect(route.connectionName).toBe(original.connectionName)
      expect(route.rootConnectionName).toBe(original.rootConnectionName)
      expect(route.route[0]).toEqual(original.route[0])
      expect(route.route.at(-1)).toEqual(original.route.at(-1))
      expect(route.traceThickness).toBe(original.traceThickness)
      expect(route.viaDiameter).toBe(original.viaDiameter)
    }
    const validation = evaluateRelaxedDrc({
      includeBoardClearance: true,
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
      drcOptions: {
        traceClearance: params.originalSrj.minTraceToPadEdgeClearance,
        viaClearance: params.originalSrj.minViaHoleEdgeToViaHoleEdgeClearance,
        includeTraceContinuity: true,
      },
    })
    expect(validation.errors).toHaveLength(0)
    const repeated = new Pipeline9JointDrcRepairSolver(
      loadPipeline9JointDrcInput(inputPath!),
    )
    repeated.solve()
    expect(repeated.solved).toBeTrue()
    expect(repeated.getOutput()).toEqual(routes)
    expect(solver.getUpdatedPreloadedTraces()).toEqual([])
    expect(solver.getMutatedPreloadedTraces()).toEqual([])
  },
)
