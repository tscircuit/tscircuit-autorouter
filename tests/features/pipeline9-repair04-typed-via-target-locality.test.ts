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

test("a repair crop selects its own typed via-trace target while preserving legacy via-pad targets", (): void => {
  const bounds = { minX: -6, maxX: 6, minY: -6, maxY: 6 }
  const srj: SimpleRouteJson = { bounds, layerCount: 2, minTraceWidth: 0.1, obstacles: [], connections: [] }
  const routes: HighDensityRoute[] = [0, 1, 2].map((x): HighDensityRoute => ({
    connectionName: `owner${x}`, traceThickness: 0.1, viaDiameter: 0.3,
    vias: [{ x, y: 0 }], route: [
      { x, y: -1, z: 0 }, { x, y: 0, z: 0 },
      { x, y: 0, z: 1 }, { x, y: 1, z: 1 },
    ],
  }))
  const errors = routes.map((_, routeIndex): {
    type: string
    center: { x: number; y: number }
    existingViaRepairTargets: { routeIndex: number; viaIndex: number; x: number; y: number }[]
  } => ({
    type: routeIndex === 2 ? "pcb_pad_pad_clearance_error" : "pcb_via_trace_clearance_error",
    center: { x: routeIndex, y: 0 },
    existingViaRepairTargets: [{ routeIndex, viaIndex: 0, x: routeIndex, y: 0 }],
  }))
  const before = structuredClone(routes)
  for (const first of [0, 1, 2]) {
    const ordered = [errors[first]!, ...errors.filter((_, index): boolean => index !== first)]
    const solver = new Pipeline9Repair04Solver({
      srj, hdRoutes: routes, connMap: getConnectivityMapFromSimpleRouteJson(srj),
      referenceDrcEvaluator: (): typeof errors => ordered,
      allowLayerChanges: true, maxRegions: 1, maxCandidatesPerRegion: 1,
    })
    solver.step()
    const access = solver as unknown as Access
    expect(solver.failed).toBe(false)
    expect(access.localSolver).not.toBeNull()
    expect(access.region).not.toBeNull()
    const [child] = access.localSolver!.getConstructorParams()
    expect(child.allowLayerChanges).toBe(false)
    const selectedSources = child.movableVias!.map(({ routeIndex }): number =>
      access.region!.routeMappings[routeIndex]!.sourceRouteIndex,
    ).sort((a, b): number => a - b)
    expect(selectedSources).toEqual(first === 2 ? [2] : [first, 2])
    expect(child.bounds.minX).toBe(first - 5)
    expect(child.bounds.maxX).toBe(first + 5)
  }
  expect(routes).toEqual(before)
})
