import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateCoreRoutingDrc } from "lib/testing/evaluate-core-routing-drc"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const createPad = (
  x: number,
  pcbPortId: string,
  connectedTo = pcbPortId,
): Obstacle => ({
  type: "rect",
  center: { x, y: 0 },
  width: 0.5,
  height: 0.5,
  layers: ["top"],
  connectedTo: [connectedTo, pcbPortId],
  circuitJsonMetadata: {
    pcb_smtpad_id: `pad_${pcbPortId}`,
    pcb_port_id: pcbPortId,
  },
})

test("Pipeline9 repairs physical DRCs already present in preloaded copper", () => {
  const connection = {
    name: "SIGNAL",
    pointsToConnect: [
      { x: -2, y: 0, layer: "top", pcb_port_id: "pcb_port_start" },
      { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_end" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    obstacles: [
      createPad(-2, "pcb_port_start"),
      createPad(2, "pcb_port_end"),
      createPad(0, "pcb_port_foreign", "FOREIGN_NET"),
    ],
    connections: [connection],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "preloaded_trace",
        connection_name: "SIGNAL",
        connectsTo: ["pcb_port_start", "pcb_port_end"],
        route: [
          {
            route_type: "wire",
            x: -2,
            y: 0,
            width: 0.1,
            layer: "top",
            start_pcb_port_id: "pcb_port_start",
          },
          {
            route_type: "wire",
            x: 2,
            y: 0,
            width: 0.1,
            layer: "top",
            end_pcb_port_id: "pcb_port_end",
          },
        ],
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const inputDrc = evaluateCoreRoutingDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [],
  })
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: [],
    newHdRoutes: [],
    updatedPreloadedTraces: srj.traces!,
    mutatedPreloadedTraceIds: new Set(),
    connMap,
    obstacles: srj.obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: { SIGNAL: "red" },
  })

  solver.solve()

  const finalDrc = evaluateCoreRoutingDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: solver.getUpdatedPreloadedTraces(),
  })
  expect(inputDrc.errors).toHaveLength(1)
  expect(solver.stats).toMatchObject({
    initialJointDrcIssueCount: 1,
    expectedUnroutedBaselineDrcIssueCount: 0,
  })
  expect(finalDrc.errors).toHaveLength(0)
})
