import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import input from "../fixtures/through-via-terminal-window.json"

const nodeWithPortPoints: NodeWithPortPoints = input.nodeWithPortPoints

test("the captured terminal window clears a through via on the fourth copper layer", async (): Promise<void> => {
  const solver = new HighDensitySolverA01(input)
  solver.solve()
  expect(solver.solved).toBeTrue()
  const routes = solver.getOutput()
  expect(routes).toHaveLength(2)
  // The captured grow/shrink search frame is 2x board-world millimetres.
  const physicalRoutes = routes.map((route) => ({
    ...route,
    traceThickness: route.traceThickness / 2,
    viaDiameter: route.viaDiameter / 2,
    route: route.route.map((point) => ({
      ...point,
      x: point.x / 2,
      y: point.y / 2,
    })),
    vias: route.vias.map((point) => ({ x: point.x / 2, y: point.y / 2 })),
  }))
  const srj: SimpleRouteJson = {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    minTraceWidth: input.traceThickness / 2,
    minViaDiameter: input.viaDiameter / 2,
    minTraceToPadEdgeClearance: input.traceMargin / 2,
    bounds: { minX: -3.5, maxX: 3.5, minY: -2.25, maxY: 0.5 },
    obstacles: [],
    connections: ["layer_transition", "neighbor"].map((name) => ({
      name,
      pointsToConnect: nodeWithPortPoints.portPoints
        .filter((port) => port.connectionName === name)
        .map((port) => ({
          x: port.x / 2,
          y: port.y / 2,
          layer: mapZToLayerName(port.z, 4),
        })),
    })),
  }
  const traces: SimplifiedPcbTrace[] = physicalRoutes.map((route, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `trace_${index}`,
    connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, 4),
  }))
  // This subcircuit has cut terminals. Check copper DRC without requiring pads
  // at the cut boundary; the production snapshot helper reports the count.
  const snapshot = {
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: traces,
    drcOptions: { includeTraceContinuity: false },
  }
  const { errors } = evaluateRelaxedDrc(snapshot)
  expect(errors).toHaveLength(1)
  await expect(
    getBugReportSnapshotSvg(snapshot, { bounds: srj.bounds }),
  ).toMatchSvgSnapshot(import.meta.path)
})
