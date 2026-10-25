import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { detailedPriority, priorityParams } from "./priorityDagTestUtils"

test("actual native plans branch on crossing copper and retain an unrelated exact-context witness", () =>
  detailedPriority(() => {
    const params = priorityParams(),
      solver = new PriorityDagIntraNodeSolver(params)
    solver.solve()
    expect(solver.error).toBeNull()
    expect(solver.solved).toBe(true)
    expect(solver.solvedRoutes).toHaveLength(3)
    expect(
      solver.priorityDiagnostics.priorityObservedConflicts,
    ).toBeGreaterThan(0)
    expect(
      solver.priorityDiagnostics.priorityWitnessesRetained,
    ).toBeGreaterThanOrEqual(2)
    expect(solver.priorityDiagnostics.priorityNativeSearches).toBeLessThan(6)
    expect(
      solver.priorityDiagnostics.priorityFinalSegmentChecks,
    ).toBeGreaterThan(0)
    for (const route of solver.solvedRoutes) {
      expect(route.regionId).toBe("region")
      expect(route.rootConnectionName).toBe(`root-${route.connectionName}`)
      expect(route.traceThickness).toBe(params.traceWidth!)
    }
    for (let i = 0; i < solver.solvedRoutes.length; i++)
      for (let j = i + 1; j < solver.solvedRoutes.length; j++) {
        expect(
          doPipeline9RoutesHaveCopperConflict({
            left: solver.solvedRoutes[i],
            right: solver.solvedRoutes[j],
            clearance: 0.1,
            layerCount: 2,
          }),
        ).toBe(false)
      }
  }))
