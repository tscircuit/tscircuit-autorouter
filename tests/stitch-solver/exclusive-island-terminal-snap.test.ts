import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("a nearby terminal is assigned to one island endpoint while its other endpoint joins the neighboring island", () => {
  const terminals: SimpleRouteConnection["pointsToConnect"] = [
    { x: 4, y: 0, layer: "bottom", pcb_port_id: "right" },
    { x: 0, y: 0, layer: "bottom", pcb_port_id: "left" },
  ]
  const inputRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      endPcbPortId: "right",
      route: [
        { x: -1.4, y: 0, z: 1 },
        { x: -1.4, y: -2, z: 1 },
        { x: 4, y: -2, z: 1 },
        { x: 4, y: 0, z: 1 },
      ],
      vias: [],
    },
    {
      connectionName: "signal",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      endPcbPortId: "left",
      route: [
        { x: -1.2, y: 0, z: 1 },
        { x: 0, y: 0, z: 1 },
      ],
      vias: [],
    },
  ]

  for (const reverseTerminals of [false, true]) {
    for (const reverseRoutes of [false, true]) {
      for (const reversePoints of [false, true]) {
        const pointsToConnect = structuredClone(terminals)
        const hdRoutes = structuredClone(inputRoutes)
        if (reverseTerminals) pointsToConnect.reverse()
        if (reverseRoutes) hdRoutes.reverse()
        if (reversePoints) {
          for (const route of hdRoutes) {
            route.route.reverse()
            ;[route.startPcbPortId, route.endPcbPortId] = [
              route.endPcbPortId,
              route.startPcbPortId,
            ]
          }
        }
        const solver = new MultipleHighDensityRouteStitchSolver3({
          connections: [{ name: "signal", pointsToConnect }],
          hdRoutes,
          layerCount: 2,
          preserveTerminalPcbPortIds: true,
          preferSameLayerTerminalEndpoints: true,
        })
        solver.solve()

        expect(solver.solved).toBe(true)
        expect(solver.failed).toBe(false)
        expect(solver.error).toBeNull()
        expect(solver.mergedHdRoutes).toHaveLength(1)
        const merged = solver.mergedHdRoutes[0]
        const endpointsById = new Map([
          [merged.startPcbPortId, merged.route[0]],
          [merged.endPcbPortId, merged.route.at(-1)!],
        ])
        expect(new Set(endpointsById.keys())).toEqual(
          new Set(["left", "right"]),
        )
        expect(endpointsById.get("left")).toMatchObject({ x: 0, y: 0, z: 1 })
        expect(endpointsById.get("right")).toMatchObject({ x: 4, y: 0, z: 1 })
        for (const point of inputRoutes.flatMap((route) => route.route)) {
          expect(merged.route).toContainEqual(point)
        }
        expect(merged.route.every((point) => point.z === 1)).toBe(true)
        expect(merged.vias).toEqual([])
      }
    }
  }
})
