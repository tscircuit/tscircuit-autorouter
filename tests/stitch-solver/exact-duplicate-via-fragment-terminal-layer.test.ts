import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("an exact repeated via fragment cannot send a terminal stitch back to the wrong layer", (): void => {
  const common = {
    connectionName: "signal", rootConnectionName: "signal_root",
    traceThickness: 0.1, viaDiameter: 0.3,
  }
  const viaRoute: HighDensityIntraNodeRoute = {
    ...common,
    route: [
      { x: 3, y: 0, z: 3 },
      { x: 3.01, y: 0.05, z: 3 },
      { x: 3.01, y: 0.05, z: 0 },
      { x: 3.05, y: 0.05, z: 0 },
      { x: 3.05, y: 0, z: 0 },
    ],
    vias: [{ x: 3.01, y: 0.05 }],
  }
  const routes: HighDensityIntraNodeRoute[] = [
    { ...common, startPcbPortId: "start", vias: [],
      route: [{ x: 0, y: 0, z: 0 }, { x: 3.05, y: 0, z: 0 }] },
    viaRoute,
    structuredClone(viaRoute),
    { ...common, endPcbPortId: "end", vias: [],
      route: [{ x: 3, y: 0, z: 3 }, { x: 3, y: -0.1, z: 3 }] },
  ]
  const before = JSON.stringify(routes)
  const single = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal", hdRoutes: routes,
    start: { x: 0, y: 0, z: 0, pcb_port_id: "start" },
    end: { x: 3, y: -0.1, z: 3, pcb_port_id: "end" },
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: () => true, stitchClearanceMode: "require_clear",
  })
  const multiple = new MultipleHighDensityRouteStitchSolver3({
    connections: [{ name: "signal", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
      { x: 3, y: -0.1, layer: "bottom", pcb_port_id: "end" },
    ] }],
    hdRoutes: routes, layerCount: 4,
    preserveTerminalPcbPortIds: true, preferSameLayerTerminalEndpoints: true,
  })
  single.solve()
  multiple.solve()
  expect(single.failed, single.error ?? "").toBe(false)
  expect(multiple.failed, multiple.error ?? "").toBe(false)
  expect(single.solved).toBe(true)
  expect(multiple.solved).toBe(true)
  expect(multiple.mergedHdRoutes).toHaveLength(1)
  for (const route of [single.mergedHdRoute, multiple.mergedHdRoutes[0]!]) {
    expect(route.route[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(route.route.at(-1)).toMatchObject({ x: 3, y: -0.1, z: 3 })
    expect(route.startPcbPortId).toBe("start")
    expect(route.endPcbPortId).toBe("end")
    expect(route.vias).toEqual([{ x: 3.01, y: 0.05 }])
    expect(route.route.filter((point, index) => index > 0 && point.z !== route.route[index - 1]!.z)).toHaveLength(1)
  }
  expect(JSON.stringify(routes)).toBe(before)
})
