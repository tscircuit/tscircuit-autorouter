import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { applyBroadRepulsionForces } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("broad pad repulsion uses the actual trace copper width", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: -0.5 },
        width: 0.8,
        height: 1,
        layers: ["top"],
        connectedTo: ["foreign-pad"],
      },
    ],
    connections: [],
  }
  const input: HighDensityRoute[] = [
    {
      connectionName: "wide-trace",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -2, y: 0.5, z: 0 },
        { x: -0.5, y: 0.165, z: 0 },
        { x: 0.5, y: 0.165, z: 0 },
        { x: 2, y: 0.5, z: 0 },
      ],
    },
  ]
  const original = structuredClone(input)
  const [output] = applyBroadRepulsionForces(srj, input, 1)
  const clearance =
    segmentToBoxMinDistance(
      output!.route[1]!,
      output!.route[2]!,
      srj.obstacles[0]!,
    ) -
    output!.traceThickness / 2
  expect(clearance).toBeGreaterThanOrEqual(0.1)
  expect(output!.traceThickness).toBe(0.15)
  expect(output!.route[0]).toEqual(input[0]!.route[0])
  expect(output!.route.at(-1)).toEqual(input[0]!.route.at(-1))
  expect(input).toEqual(original)
})
