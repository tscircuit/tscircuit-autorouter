import { test, expect } from "bun:test"
import { AutoroutingPipelineSolver } from "lib/solvers/AutoroutingPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

test("AutoroutingPipelineSolver > full integration with internally connected pairs", () => {
  const testSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    obstacles: [],
    connections: [
      {
        name: "RP2040_SYSTEM",
        pointsToConnect: [
          // IOVDD pins (internally connected)
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "IOVDD_1",
            pcb_port_id: "rp2040_iovdd_1",
          },
          {
            x: 5,
            y: 0,
            layer: "top",
            pointId: "IOVDD_2",
            pcb_port_id: "rp2040_iovdd_2",
          },
          {
            x: 10,
            y: 0,
            layer: "top",
            pointId: "IOVDD_3",
            pcb_port_id: "rp2040_iovdd_3",
          },

          // External power components
          {
            x: 20,
            y: 5,
            layer: "top",
            pointId: "POWER_REG",
            pcb_port_id: "ldo_output",
          },
          {
            x: 25,
            y: -5,
            layer: "top",
            pointId: "DECAP_1",
            pcb_port_id: "capacitor_1",
          },
          {
            x: 30,
            y: 5,
            layer: "top",
            pointId: "DECAP_2",
            pcb_port_id: "capacitor_2",
          },
        ],
        internallyConnectedPointIds: [["IOVDD_1", "IOVDD_2", "IOVDD_3"]],
      },
    ],
    bounds: { minX: -5, maxX: 35, minY: -10, maxY: 15 },
  }

  const solver = new AutoroutingPipelineSolver(testSrj)

  // Run through the net to point pairs solver
  while (
    !solver.solved &&
    !solver.failed &&
    solver.getCurrentPhase() !== "nodeSolver"
  ) {
    solver.step()
  }

  expect(solver.netToPointPairsSolver?.solved).toBe(true)

  const newSrj = solver.netToPointPairsSolver?.getNewSimpleRouteJson()
  expect(newSrj).toBeDefined()

  if (newSrj) {
    // Should have created some connections
    expect(newSrj.connections.length).toBeGreaterThan(0)

    // Verify internal points are handled correctly
    const allPointIds = newSrj.connections
      .flatMap((conn) => conn.pointsToConnect.map((p) => p.pointId))
      .filter(Boolean)

    const internalPoints = allPointIds.filter((id) => id?.startsWith("IOVDD_"))
    expect(new Set(internalPoints).size).toBeLessThanOrEqual(1)

    // Should have external components
    expect(allPointIds.some((id) => id === "POWER_REG")).toBe(true)
    expect(allPointIds.some((id) => id === "DECAP_1")).toBe(true)
    expect(allPointIds.some((id) => id === "DECAP_2")).toBe(true)
  }
})
