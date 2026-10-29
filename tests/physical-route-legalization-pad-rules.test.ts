import { expect, test } from "bun:test"
import { legalizeHighDensityRouteProposal } from "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("trace and via pad-clearance rules both override a weaker generic obstacle margin", () => {
  const viaRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "b",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0.22, z: 0 },
        { x: 1, y: 0.22, z: 0 },
      ],
      vias: [],
    },
  ]
  const traceRoutes: HighDensityIntraNodeRoute[] = [
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
    {
      connectionName: "b",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0.5, z: 0 },
        { x: 0, y: 0.22, z: 0, pcb_port_id: "fixed-via" },
        { x: 0, y: 0.22, z: 1 },
        { x: 1, y: 0.5, z: 1 },
      ],
      vias: [{ x: 0, y: 0.22 }],
    },
  ]
  for (const [routes, centerY, copperRadius] of [
    [viaRoutes, -0.47, 0.15],
    [traceRoutes, -0.37, 0.05],
  ] as const) {
    const result = legalizeHighDensityRouteProposal({
      routes: [...routes],
      mode: "selective",
      node: {
        capacityMeshNodeId: "test",
        center: { x: 0, y: 0 },
        width: 3,
        height: 3,
        portPoints: [],
      },
      layerCount: 2,
      clearance: 0.1,
      minTraceToPadEdgeClearance: 0.2,
      viaToPadClearance: 0.2,
      obstacles: [
        {
          type: "rect",
          shape: "circle",
          center: { x: 0, y: centerY },
          width: 0.2,
          height: 0.2,
          layers: ["top", "bottom"],
          connectedTo: [],
        },
      ],
    })
    const point =
      copperRadius === 0.15
        ? result.routes[0]!.vias[0]!
        : result.routes[0]!.route[1]!
    expect(
      Math.hypot(point.x, point.y - centerY) - 0.1 - copperRadius,
    ).toBeGreaterThanOrEqual(0.2 - 1e-8)
    expect(result.status).not.toBe("clean")
  }
})
