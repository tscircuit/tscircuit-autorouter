import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("a narrow surface escape does not narrow a clear interconnect layer", async (): Promise<void> => {
  const input: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 13, minY: -2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.45,
    minViaHoleDiameter: 0.2,
    minTraceToPadEdgeClearance: 0.1,
    obstacles: [
      {
        type: "rect",
        center: { x: 1, y: 0.22 },
        width: 1,
        height: 0.1,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "signal",
        nominalTraceWidth: 0.2,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "signal_start" },
          { x: 12, y: 0, layer: "bottom", pcb_port_id: "signal_end" },
        ],
      },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "signal",
    startPcbPortId: "signal_start",
    endPcbPortId: "signal_end",
    traceThickness: 0.1,
    viaDiameter: 0.45,
    vias: [{ x: 2, y: 0 }],
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 12, y: 0, z: 1 },
    ],
  }
  const solver = new TraceWidthSolver({
    hdRoutes: [route],
    connection: input.connections,
    obstacles: input.obstacles,
    minTraceWidth: input.minTraceWidth,
    obstacleMargin: input.minTraceToPadEdgeClearance,
    layerCount: input.layerCount,
  })
  solver.solve()
  const [refined] = solver.refineWidths({
    hdRoutes: solver.getHdRoutesWithWidths(),
  })
  const traces = [
    {
      type: "pcb_trace" as const,
      pcb_trace_id: "signal",
      connection_name: "signal",
      route: convertHdRouteToSimplifiedRoute(refined!, input.layerCount, {
        defaultViaHoleDiameter: input.minViaHoleDiameter,
      }),
    },
  ]
  const wires = traces[0]!.route.filter((point) => point.route_type === "wire")
  expect(
    wires
      .filter((point) => point.layer === "top")
      .every((point) => point.width === 0.1),
  ).toBe(true)
  expect(
    wires
      .filter((point) => point.layer === "bottom")
      .every((point) => point.width === 0.2),
  ).toBe(true)
  expect(refined!.route.map(({ x, y, z }) => ({ x, y, z }))).toEqual(route.route)
  expect(refined!.vias).toEqual(route.vias)
  const snapshot = { inputSrj: input, srjWithPointPairs: input, routedTraces: traces }
  expect(evaluateRelaxedDrc(snapshot).errors).toEqual([])
  await expect(getBugReportSnapshotSvg(snapshot)).toMatchSvgSnapshot(import.meta.path)
})
