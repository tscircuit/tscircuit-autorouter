import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("legacy island snapping preserves distinct terminal identities", (): void => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "bottom", pcb_port_id: "pad-a" },
          { x: 10, y: 0, layer: "bottom", pcb_port_id: "pad-b" },
        ],
      },
    ],
    hdRoutes: [
      {
        connectionName: "signal",
        startPcbPortId: "pad-a",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 1 },
          { x: 0.5, y: 0, z: 1 },
          { x: 0.5, y: 0, z: 0 },
          { x: 0.7, y: 0, z: 0 },
        ],
        vias: [{ x: 0.5, y: 0 }],
      },
      {
        connectionName: "signal",
        endPcbPortId: "pad-b",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 5, y: 0, z: 1 },
          { x: 10, y: 0, z: 1 },
        ],
        vias: [],
      },
    ],
    layerCount: 2,
    enableCompleteTerminalStitching: false,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })

  const startIsland = solver.unsolvedRoutes.find(
    (route) => (route.start as { pcb_port_id?: string }).pcb_port_id === "pad-a",
  )!
  expect(startIsland.end).toEqual({ x: 0.7, y: 0, z: 0 })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.mergedHdRoutes).toHaveLength(2)
  expect(
    solver.mergedHdRoutes.flatMap((route) =>
      [route.startPcbPortId, route.endPcbPortId].filter(Boolean),
    ).sort(),
  ).toEqual(["pad-a", "pad-b"])
})
