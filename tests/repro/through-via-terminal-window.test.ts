import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { applyToPoint, compose, scale, translate } from "transformation-matrix"
import input from "../fixtures/through-via-terminal-window.json"

const nodeWithPortPoints: NodeWithPortPoints = input.nodeWithPortPoints

test("the complete captured region exposes through vias covering foreign terminals", async (): Promise<void> => {
  // All 52 terminals from the observed regional candidate, without reduction.
  const solver = new HighDensitySolverA01(input)
  solver.solve()
  expect(solver.solved).toBeTrue()
  const routes = solver.getOutput()
  expect(routes).toHaveLength(26)
  const center = nodeWithPortPoints.center
  // Undo the captured grow/shrink candidate's 2x search frame about its center.
  const searchToBoard = compose(
    translate(center.x, center.y),
    scale(0.5),
    translate(-center.x, -center.y),
  )
  const physicalRoutes = routes.map((route) => ({
    ...route,
    traceThickness: route.traceThickness / 2,
    viaDiameter: route.viaDiameter / 2,
    route: route.route.map((point) => ({
      ...point,
      ...applyToPoint(searchToBoard, point),
    })),
    vias: route.vias.map((point) => applyToPoint(searchToBoard, point)),
  }))
  const srj: SimpleRouteJson = {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    minTraceWidth: input.traceThickness / 2,
    minViaDiameter: input.viaDiameter / 2,
    bounds: { minX: -11.4, maxX: -3.8, minY: -11.3, maxY: -5.8 },
    obstacles: [],
    connections: [
      ...new Set(nodeWithPortPoints.portPoints.map((port) => port.connectionName)),
    ].map((name) => ({
      name,
      rootConnectionName: nodeWithPortPoints.portPoints.find(
        (port) => port.connectionName === name,
      )!.rootConnectionName,
      pointsToConnect: nodeWithPortPoints.portPoints
        .filter((port) => port.connectionName === name)
        .map((port) => ({
          ...applyToPoint(searchToBoard, port),
          layer: mapZToLayerName(port.z, 4),
        })),
    })),
  }
  const traces: SimplifiedPcbTrace[] = physicalRoutes.map((route, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `route_${index}`,
    connection_name: route.connectionName,
    rootConnectionName: route.rootConnectionName,
    route: convertHdRouteToSimplifiedRoute(route, 4),
  }))
  // These are cut terminals, so the benchmark copper checks exclude continuity
  // to pads outside the captured region. Other existing copper errors remain.
  const snapshot = {
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: traces,
    drcOptions: { includeTraceContinuity: false },
  }
  const { errors } = evaluateRelaxedDrc(snapshot)
  expect(errors).toHaveLength(14)
  await expect(
    getBugReportSnapshotSvg(snapshot, { bounds: srj.bounds }),
  ).toMatchSvgSnapshot(import.meta.path)
})
