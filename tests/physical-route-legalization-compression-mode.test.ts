import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("compression-only preserves copper and metadata without constructing a physical scene", () => {
  const annotatedPoint = { x: 0, y: 0, z: 0, portPointId: "branch-identity" }
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: -0.5, y: 0, z: 0 },
        annotatedPoint,
        { x: 0.5, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const original = structuredClone(routes)
  const result = legalizeHighDensityRouteProposal({
    mode: "compression-only",
    routes,
    node: {
      capacityMeshNodeId: "test",
      center: { x: 0, y: 0 },
      width: 3,
      height: 3,
      portPoints: [],
    },
    layerCount: 2,
    clearance: 0.1,
    get obstacles(): never {
      throw new Error("Compression must not read physical obstacles")
    },
    get connMap(): never {
      throw new Error("Compression must not inspect connectivity")
    },
  })
  expect(result.status).toBe("compressed")
  expect(result.metricsRecorded).toBe(false)
  expect(result.copperPairsBefore).toBeNull()
  expect(result.lossAfter).toBeNull()
  expect(result.movableConflictCount).toBeNull()
  expect(result.immutableConflictCount).toBeNull()
  expect(result.energyEvaluationCount).toBe(0)
  expect(result.geometryWork).toBe(0)
  expect(result.routes[0]!.route).toEqual([
    original[0]!.route[0]!,
    original[0]!.route[2]!,
    original[0]!.route[4]!,
  ])
  expect(result.routes[0]!.traceThickness).toBe(0.1)
  expect(routes).toEqual(original)
})
