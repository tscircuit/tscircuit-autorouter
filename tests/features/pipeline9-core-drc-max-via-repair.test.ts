import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateCoreRoutingDrc } from "lib/testing/evaluate-core-routing-drc"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 Repair03 consumes Core maximum-via DRC errors", () => {
  const connection: SimpleRouteConnection = {
    name: "signal",
    maxViaCount: 0,
    pointsToConnect: [
      { x: -2, y: 0, layer: "top", pcb_port_id: "start" },
      { x: 2, y: 0, layer: "top", pcb_port_id: "end" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaHoleDiameter: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        center: { x: -2, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["signal", "start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad_start",
          pcb_port_id: "start",
        },
      },
      {
        type: "rect",
        center: { x: 2, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["signal", "end"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad_end",
          pcb_port_id: "end",
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
        connectionName: "signal",
        rootConnectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: -2, y: 0, z: 0, pcb_port_id: "start" },
          { x: -0.5, y: 0, z: 0 },
          { x: -0.5, y: 0, z: 1 },
          { x: 0.5, y: 0, z: 1 },
          { x: 0.5, y: 0, z: 0 },
          { x: 2, y: 0, z: 0, pcb_port_id: "end" },
        ],
        vias: [
          { x: -0.5, y: 0 },
          { x: 0.5, y: 0 },
        ],
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
    colorMap: { signal: "red" },
  })

  expect(solver.stats.initialJointDrcIssueCount).toBe(1)
  expect(solver.solved).toBeFalse()
  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(Number(solver.stats.referenceDrcValidationCount)).toBeGreaterThan(0)
  expect(
    Number(solver.stats.globalDrcForceImproveCandidateAttempts),
  ).toBeGreaterThan(0)
  const output = solver.getOutput()
  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: [connection],
    originalConnections: [connection],
    hdRoutes: output,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap: solver.params.connMap,
  })
  const finalDrc = evaluateCoreRoutingDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces,
  })
  expect(finalDrc.errors).toHaveLength(1)
  expect(finalDrc.errors[0]?.pcb_trace_error_id).toStartWith(
    "max_via_count_exceeded_",
  )
})
