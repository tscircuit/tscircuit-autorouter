import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("off mode returns the original proposal without geometry or node inspection", () => {
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const result = legalizeHighDensityRouteProposal({
    mode: "off",
    routes,
    layerCount: 2,
    clearance: 0.1,
    get node(): never {
      throw new Error("Disabled legalization must not inspect the node")
    },
  })
  expect(result.routes).toBe(routes)
  expect(result.status).toBe("disabled")
  expect(result.metricsRecorded).toBe(false)
  expect(result.copperPairsAfter).toBeNull()
  expect(result.iterations).toBe(0)
  expect(result.energyEvaluationCount).toBe(0)
})
