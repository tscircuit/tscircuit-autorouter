import { expect, test } from "bun:test"
import { Pipeline9InheritedDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InheritedDrcRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPipeline9InheritedPadClearanceFixture } from "../fixtures/create-pipeline9-inherited-pad-clearance-fixture"

test("Pipeline9 inherited repair does no native search without ordinary preloaded ownership", (): void => {
  const fixture = createPipeline9InheritedPadClearanceFixture()
  const srj = structuredClone(fixture.srj)
  srj.traces = []
  const newRoutes: HighDensityRoute[] = [
    {
      connectionName: "preloaded",
      rootConnectionName: "preloaded",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: -0.34, z: 0, pcb_port_id: "preloaded_start" },
        { x: -0.6, y: -0.34, z: 0 },
        { x: 0.6, y: -0.34, z: 0 },
        { x: 2, y: -0.34, z: 0, pcb_port_id: "preloaded_end" },
      ],
      vias: [],
    },
  ]
  const solver = new Pipeline9InheritedDrcRepairSolver({
    ...fixture.solver.getConstructorParams()[0],
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: newRoutes,
    updatedPreloadedTraces: srj.traces,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
  })

  expect(solver.stats.initialJointDrcIssueCount).toBe(1)
  expect(solver.movablePreloadedSections).toHaveLength(0)
  expect(solver.stats.inheritedRepairSkippedForEmptyOwnership).toBeTrue()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  solver.step()
  expect(solver.iterations).toBe(0)
  expect(solver.exactRepairSolver?.iterations).toBe(0)
  expect(solver.activeSubSolver).toBeNull()
  expect(solver.getOutput()).toBe(newRoutes)
  expect(solver.getUpdatedPreloadedTraces()).toBe(srj.traces)
  expect(solver.getMutatedPreloadedTraces()).toEqual([])
})
