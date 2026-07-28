import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator, SimpleRouteJson } from "high-density-repair03/lib"
import { DrcGuardedTraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/drc-guarded-trace-simplification-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const srj: SimpleRouteJson = {
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  connections: [
    {
      name: "editable",
      pointsToConnect: [
        { x: -1, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
  ],
  obstacles: [],
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
}

const routeWithRemovableVias: HighDensityRoute = {
  connectionName: "editable",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: -1, y: 0, z: 0 },
    { x: -0.5, y: 0, z: 0 },
    { x: -0.5, y: 0, z: 1 },
    { x: 0.5, y: 0, z: 1 },
    { x: 0.5, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ],
  vias: [
    { x: -0.5, y: 0 },
    { x: 0.5, y: 0 },
  ],
}

const createSolver = (
  drcEvaluator: DrcEvaluator,
): DrcGuardedTraceSimplificationSolver =>
  new DrcGuardedTraceSimplificationSolver({
    hdRoutes: [structuredClone(routeWithRemovableVias)],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
    srj,
    drcEvaluator,
  })

test("DRC-guarded simplification accepts safe via removal and rejects a DRC regression", () => {
  const acceptingSolver = createSolver(() => [])
  acceptingSolver.solve()

  expect(acceptingSolver.failed).toBe(false)
  expect(acceptingSolver.decision?.accepted).toBe(true)
  expect(acceptingSolver.getOutput()[0]?.vias).toHaveLength(0)

  const viaRemovalDrcEvaluator: DrcEvaluator = ({ routes }) => {
    const vias = routes?.[0]?.vias ?? []
    if (vias.length > 0) return []
    return [
      {
        message: "The layer detour represented by these vias is required",
        pcb_trace_id: "editable_0",
      },
    ]
  }
  const rejectingSolver = createSolver(viaRemovalDrcEvaluator)
  rejectingSolver.solve()

  expect(rejectingSolver.failed).toBe(false)
  expect(rejectingSolver.decision?.inputDrc.count).toBe(0)
  expect(rejectingSolver.decision?.candidateDrc.count).toBe(1)
  expect(rejectingSolver.decision?.accepted).toBe(false)
  expect(rejectingSolver.getOutput()).toEqual([routeWithRemovableVias])
})
