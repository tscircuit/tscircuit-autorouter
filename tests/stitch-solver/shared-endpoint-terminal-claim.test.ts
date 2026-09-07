import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("shared endpoint clustering preserves terminal claims and rejects conflicting ownership", (): void => {
  for (const firstClaim of [undefined, "start-port", "conflicting-port"]) {
    const routes: HighDensityIntraNodeRoute[] = [
      {
        connectionName: "shared-net",
        startPcbPortId: firstClaim,
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName: "shared-net",
        startPcbPortId: "start-port",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
        ],
        vias: [],
      },
    ]
    const createSolver = (): MultipleHighDensityRouteStitchSolver3 => {
      return new MultipleHighDensityRouteStitchSolver3({
        connections: [
          {
            name: "shared-net",
            pointsToConnect: [
              { x: 0, y: 0, layer: "bottom", pcb_port_id: "start-port" },
              { x: 2, y: 0, layer: "top", pcb_port_id: "end-port" },
            ],
          },
        ],
        hdRoutes: routes,
        layerCount: 2,
        preserveTerminalPcbPortIds: true,
      })
    }
    const inputSnapshot = structuredClone(routes)
    if (firstClaim === "conflicting-port") {
      expect(createSolver).toThrow("unknown PCB terminal")
    } else {
      const solver = createSolver()
      expect(solver.unsolvedRoutes).toHaveLength(1)
      expect(solver.unsolvedRoutes[0]!.start).toMatchObject({
        x: 0,
        y: 0,
        z: 1,
        pcb_port_id: "start-port",
      })
    }
    expect(routes).toEqual(inputSnapshot)
  }
})
