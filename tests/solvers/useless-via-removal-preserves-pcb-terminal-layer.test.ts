import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("preserves authoritative single-layer PCB-port terminals across simplification passes", () => {
  const terminalObstacles: Obstacle[] = [
    {
      type: "rect",
      layers: ["top"],
      __zLayers: [0],
      center: { x: 0, y: 0 },
      width: 0.4,
      height: 0.4,
      connectedTo: ["net0"],
    },
    {
      type: "rect",
      layers: ["bottom"],
      __zLayers: [1],
      center: { x: 0.15, y: 0 },
      width: 0.4,
      height: 0.4,
      connectedTo: ["net0"],
    },
  ]
  const forwardRoute: HighDensityRoute = {
    connectionName: "route0",
    rootConnectionName: "net0",
    startPcbPortId: "pcb_port_top",
    endPcbPortId: "pcb_port_bottom",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
    ],
    vias: [{ x: 1, y: 0 }],
  }
  const reverseRoute: HighDensityRoute = {
    ...forwardRoute,
    connectionName: "route1",
    startPcbPortId: forwardRoute.endPcbPortId,
    endPcbPortId: forwardRoute.startPcbPortId,
    route: [...forwardRoute.route].reverse(),
  }

  for (const route of [forwardRoute, reverseRoute]) {
    const solver = new TraceSimplificationSolver({
      hdRoutes: [structuredClone(route)],
      obstacles: terminalObstacles,
      connMap: new ConnectivityMap({ net0: [route.connectionName] }),
      colorMap: {},
      defaultViaDiameter: 0.3,
      layerCount: 2,
      enableCrossingViaReduction: true,
      pcbPortZLayers: new Map([
        ["pcb_port_top", new Set([0])],
        ["pcb_port_bottom", new Set([1])],
      ]),
    })

    solver.solve()

    const optimizedRoute = solver.simplifiedHdRoutes[0]!
    expect(solver.failed).toBe(false)
    expect(optimizedRoute.route[0]).toMatchObject(route.route[0]!)
    expect(optimizedRoute.route.at(-1)).toMatchObject(route.route.at(-1)!)
    expect(optimizedRoute.vias).toEqual(route.vias)
    expect(optimizedRoute.startPcbPortId).toBe(route.startPcbPortId)
    expect(optimizedRoute.endPcbPortId).toBe(route.endPcbPortId)
    if (route === forwardRoute) {
      expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
    }
  }
})
