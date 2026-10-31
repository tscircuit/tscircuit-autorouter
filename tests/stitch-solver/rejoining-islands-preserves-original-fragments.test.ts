import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("rejoining islands retains fragments pruned from an individual island", (): void => {
  const fragments: HighDensityRoute["route"][] = [
    [{ x: 0.8, y: 0.44, z: 2 }],
    [
      { x: 1.14, y: 1.37, z: 2 },
      { x: 1.52, y: 1.84, z: 2 },
      { x: 1.52, y: 1.84, z: 1 },
    ],
    [{ x: 1.52, y: 1.84, z: 1 }, { x: 1.94, y: 1.77, z: 1 }],
    [{ x: 1.94, y: 1.77, z: 1 }, { x: 2.08, y: 1.63, z: 1 }],
    [
      { x: 2.74, y: 2.12, z: 1 },
      { x: 2.69, y: 2.6, z: 1 },
      { x: 2.69, y: 2.6, z: 0 },
    ],
    [{ x: 2.96, y: 2.82, z: 0 }],
    [{ x: 3.79, y: 3.67, z: 0 }, { x: 3.7, y: 3.48, z: 0 }],
  ]
  const solver = new MultipleHighDensityRouteStitchSolver3({
    layerCount: 3,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
    connections: [{
      name: "signal",
      pointsToConnect: [
        { x: 0, y: 0, layer: "bottom", pcb_port_id: "a" },
        { x: 4.02, y: 3.63, layer: "top", pcb_port_id: "b" },
      ],
    }],
    hdRoutes: fragments.map((route): HighDensityRoute => ({
      connectionName: "signal",
      rootConnectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route,
      vias: route.slice(1).flatMap((point, index) =>
        point.z === route[index]!.z ? [] : [{ x: point.x, y: point.y }],
      ),
    })),
  })
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const route = solver.mergedHdRoutes[0]!
  expect(Object.fromEntries([
    [route.startPcbPortId, route.route[0]],
    [route.endPcbPortId, route.route.at(-1)],
  ])).toEqual({
    a: { x: 0, y: 0, z: 2 },
    b: { x: 4.02, y: 3.63, z: 0 },
  })
})
