import { expect, test } from "bun:test"
import type { ExtractedRepairRegion, Repair04SolverInput } from "@tscircuit/repair04"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"

type Access = {
  localSolver: { getConstructorParams(): [Repair04SolverInput] } | null
  region: ExtractedRepairRegion | null
}

test("nearby typed-via targets receive distinct searches when their crop centers share a rounded key", (): void => {
  const bounds = { minX: -6, maxX: 6, minY: -6, maxY: 6 }
  const srj: SimpleRouteJson = { bounds, layerCount: 2, minTraceWidth: 0.1, obstacles: [], connections: [] }
  const routes: HighDensityRoute[] = [0, 0.1].map((x): HighDensityRoute => ({
    connectionName: `owner${x}`, traceThickness: 0.1, viaDiameter: 0.3,
    vias: [{ x, y: 0 }], route: [
      { x, y: -1, z: 0 }, { x, y: 0, z: 0 },
      { x, y: 0, z: 1 }, { x, y: 1, z: 1 },
    ],
  }))
  const errors = routes.map((route, routeIndex): {
    type: string
    center: { x: number; y: number }
    existingViaRepairTargets: { routeIndex: number; viaIndex: number; x: number; y: number }[]
  } => ({
    type: "pcb_via_trace_clearance_error", center: route.vias[0]!,
    existingViaRepairTargets: [{ routeIndex, viaIndex: 0, ...route.vias[0]! }],
  }))
  const solver = new Pipeline9Repair04Solver({
    srj, hdRoutes: routes, connMap: getConnectivityMapFromSimpleRouteJson(srj),
    referenceDrcEvaluator: (): typeof errors => errors,
    allowLayerChanges: false, maxRegions: 16, maxCandidatesPerRegion: 1,
  })
  let previous: Access["localSolver"] = null
  const selected: number[][] = []
  while (!solver.solved && !solver.failed) {
    solver.step()
    expect(solver.iterations).toBeLessThan(200)
    const access = solver as unknown as Access
    if (access.localSolver && access.localSolver !== previous) {
      previous = access.localSolver
      const [child] = previous.getConstructorParams()
      if (child.movableVias!.length) selected.push(child.movableVias!.map(({ routeIndex }): number =>
        access.region!.routeMappings[routeIndex]!.sourceRouteIndex,
      ))
    }
  }
  expect(solver.failed).toBe(false)
  expect(solver.stats.acceptedRegions).toBe(0)
  expect(solver.getOutput()).toEqual(routes)
  expect(selected).toEqual([[0], [0], [0], [1], [1], [1]])
})
