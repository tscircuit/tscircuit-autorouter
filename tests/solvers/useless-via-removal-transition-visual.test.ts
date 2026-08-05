import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("visualizes a route after a layer section is removed", async () => {
  const connectionName = "multilayer_net"
  const route: HighDensityRoute = {
    connectionName,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 },
      { x: 2, y: 0, z: 2 },
      { x: 3, y: 0, z: 2 },
    ],
    vias: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
  }
  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({ net0: [connectionName] }),
  })
  solver.solve()

  const srj: SimpleRouteJson = {
    layerCount: 3,
    minTraceWidth: route.traceThickness,
    minViaPadDiameter: route.viaDiameter,
    minViaHoleDiameter: route.viaDiameter / 2,
    bounds: { minX: -0.5, maxX: 3.5, minY: -1, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        obstacleId: "start-pad",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["start-port"],
      },
      {
        type: "rect",
        obstacleId: "end-pad",
        layers: ["bottom"],
        center: { x: 3, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["end-port"],
      },
    ],
    connections: [
      {
        name: connectionName,
        pointsToConnect: [
          { pointId: "start-port", x: 0, y: 0, layer: "top" },
          { pointId: "end-port", x: 3, y: 0, layer: "bottom" },
        ],
      },
    ],
  }
  const simplifiedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "multilayer_trace",
    connection_name: connectionName,
    route: convertHdRouteToSimplifiedRoute(
      solver.getOptimizedHdRoute(),
      srj.layerCount,
    ),
  }
  const circuitJson = convertToCircuitJson(srj, [simplifiedTrace], {
    minTraceWidth: srj.minTraceWidth,
  })

  await expect(
    convertCircuitJsonToPcbSvg(circuitJson as AnyCircuitElement[]),
  ).toMatchSvgSnapshot(import.meta.path)
})
