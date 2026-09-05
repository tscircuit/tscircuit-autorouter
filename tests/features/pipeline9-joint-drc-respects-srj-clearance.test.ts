import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

test("Pipeline9 targets relaxed trace spacing even when the SRJ permits tighter escapes", async () => {
  const routeY = -0.36
  const connection: SimpleRouteConnection = {
    name: "route",
    pointsToConnect: [
      {
        x: -2,
        y: routeY,
        layer: "top",
        pointId: "route_start",
        pcb_port_id: "route_start",
      },
      {
        x: 2,
        y: routeY,
        layer: "top",
        pointId: "route_end",
        pcb_port_id: "route_end",
      },
    ],
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: -2, y: routeY },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["route_start"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "pad_route_start",
        pcb_port_id: "route_start",
      },
    },
    {
      type: "rect",
      center: { x: 2, y: routeY },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["route_end"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "pad_route_end",
        pcb_port_id: "route_end",
      },
    },
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["foreign_net"],
      circuitJsonMetadata: { pcb_smtpad_id: "pad_foreign" },
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -3, minY: -1, maxX: 3, maxY: 1 },
    obstacles,
    connections: [connection],
  }
  const route: HighDensityRoute = {
    connectionName: "route",
    rootConnectionName: "route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: routeY, z: 0, pcb_port_id: "route_start" },
      { x: 2, y: routeY, z: 0, pcb_port_id: "route_end" },
    ],
    vias: [],
  }

  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: [connection],
    newHdRoutes: [route],
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: { route: "red" },
  })

  expect(solver.stats.initialJointDrcIssueCount).toBe(1)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.getOutput()[0]!.route[0]).toEqual(route.route[0])
  expect(solver.getOutput()[0]!.route.at(-1)).toEqual(route.route.at(-1))

  const routedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "pcb_trace_route",
    connection_name: "route",
    connectsTo: ["route_start", "route_end"],
    route: [
      {
        route_type: "wire",
        x: -2,
        y: routeY,
        width: 0.1,
        layer: "top",
        start_pcb_port_id: "route_start",
      },
      {
        route_type: "wire",
        x: 2,
        y: routeY,
        width: 0.1,
        layer: "top",
        end_pcb_port_id: "route_end",
      },
    ],
  }
  const benchmarkClearanceDrc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [routedTrace],
  })
  const declaredClearanceDrc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [routedTrace],
    drcOptions: { traceClearance: srj.minTraceToPadEdgeClearance },
  })

  expect(benchmarkClearanceDrc.errors.length).toBeGreaterThan(0)
  expect(declaredClearanceDrc.errors).toHaveLength(0)
  const repairedTrace = {
    ...routedTrace,
    route: convertHdRouteToSimplifiedRoute(solver.getOutput()[0]!, 2),
  }
  const repairedDrc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [repairedTrace],
  })
  expect(repairedDrc.errors).toHaveLength(0)
  const routeGraphics = convertSrjToGraphicsObject(
    { ...srj, traces: [routedTrace] },
    { traceColorMode: "net" },
  )
  await expect(
    getGraphicsSvgFrames({
      columns: 2,
      backgroundColor: "white",
      frames: [
        {
          name: `Preferred 0.10mm: ${benchmarkClearanceDrc.errors.length} DRC error`,
          graphics: {
            ...routeGraphics,
            rects: [
              ...(routeGraphics.rects ?? []),
              {
                center: { x: 0, y: 0 },
                width: 0.7,
                height: 0.7,
                fill: "rgba(255, 0, 0, 0.08)",
                stroke: "red",
                label: "0.10mm pad clearance boundary",
              },
            ],
          },
        },
        {
          name: `After repair at 0.10mm: ${repairedDrc.errors.length} DRC errors`,
          graphics: {
            ...convertSrjToGraphicsObject(
              { ...srj, traces: [repairedTrace] },
              { traceColorMode: "net" },
            ),
            rects: [
              ...(routeGraphics.rects ?? []),
              {
                center: { x: 0, y: 0 },
                width: 0.7,
                height: 0.7,
                fill: "rgba(0, 128, 0, 0.08)",
                stroke: "green",
                label: "0.10mm pad clearance boundary",
              },
            ],
          },
        },
      ],
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "clearance-comparison",
    tolerance: 0,
  })
})
