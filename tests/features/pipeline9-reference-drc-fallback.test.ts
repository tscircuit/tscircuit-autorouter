import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const createEndpointPad = (x: number, pcbPortId: string): Obstacle => ({
  type: "rect",
  center: { x, y: 0 },
  width: 0.5,
  height: 0.5,
  layers: ["top"],
  connectedTo: [pcbPortId],
  circuitJsonMetadata: {
    pcb_smtpad_id: `pad_${pcbPortId}`,
    pcb_port_id: pcbPortId,
  },
})

test("Pipeline9 falls back to reference DRC for an indexed-engine false negative", () => {
  const connection = {
    name: "route",
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
      createEndpointPad(-2, "pcb_port_start"),
      createEndpointPad(2, "pcb_port_end"),
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["foreign_net"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_foreign",
        },
      },
    ],
    connections: [connection],
  }
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: [connection],
    newHdRoutes: [
      {
        connectionName: "route",
        rootConnectionName: "route",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: -2, y: 0, z: 0, pcb_port_id: "pcb_port_start" },
          { x: 2, y: 0, z: 0, pcb_port_id: "pcb_port_end" },
        ],
        vias: [],
      },
    ],
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: { route: "red" },
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(Number(solver.stats.referenceDrcValidationCount)).toBeGreaterThan(0)
  expect(Number(solver.stats.referenceDrcFalseNegativeCount)).toBeGreaterThan(0)
  expect(solver.stats).toMatchObject({
    initialJointDrcIssueCount: 1,
    finalDrcIssueCount: 0,
    globalDrcForceImproveTargetedForceAccepted: true,
  })

  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: [connection],
    originalConnections: [connection],
    hdRoutes: solver.getOutput(),
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap: solver.params.connMap,
  })
  const finalDrc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces,
  })
  expect(finalDrc.errors).toHaveLength(0)
})
