import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("same-layer terminal selection accepts every declared plated-terminal layer", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layers: ["top", "bottom"], pcb_port_id: "plated" },
          { x: 3, y: 0, layer: "top", pcb_port_id: "surface" },
        ],
      },
    ],
    hdRoutes: [
      {
        connectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        startPcbPortId: "plated",
        endPcbPortId: "surface",
        route: [
          { x: 0, y: 0, z: 7 },
          { x: 1, y: 0, z: 7 },
          { x: 1, y: 0, z: 0 },
          { x: 3, y: 0, z: 0 },
        ],
        vias: [{ x: 1, y: 0 }],
      },
    ],
    layerCount: 8,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const merged = solver.mergedHdRoutes[0]
  const endpointsById = new Map([
    [merged.startPcbPortId, merged.route[0]],
    [merged.endPcbPortId, merged.route.at(-1)!],
  ])
  expect(new Set(endpointsById.keys())).toEqual(new Set(["plated", "surface"]))
  expect(endpointsById.get("plated")!.z).toBe(7)
  expect(endpointsById.get("surface")!.z).toBe(0)
})
