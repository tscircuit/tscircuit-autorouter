import { expect, test } from "bun:test"
import type {
  DrcEvaluator,
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"
import { DrcMonotonicGlobalDrcForceImproveSolver } from "lib/solvers/GlobalDrcForceImproveSolver/drc-monotonic-global-drc-force-improve-solver"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: [
    {
      name: "A",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
  ],
  bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
}

const route: HighDensityRoute = {
  connectionName: "A",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ],
  vias: [],
}

test("global DRC optimization throws when its output regresses", (): void => {
  let evaluationCount = 0
  const drcEvaluator: DrcEvaluator = () => {
    evaluationCount++
    const errorCount = evaluationCount === 1 ? 1 : 2
    return Array.from({ length: errorCount }, (_, index) => ({
      message: `synthetic DRC error ${index}`,
    }))
  }
  const solver = new DrcMonotonicGlobalDrcForceImproveSolver({
    srj,
    hdRoutes: [route],
    drcEvaluator,
  })

  expect(() => solver.solve()).toThrow(
    "Global DRC optimization regressed from 1 issue(s)",
  )
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
})
