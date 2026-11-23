import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const createPad = (x: number, y: number, pcbPortId: string): Obstacle => ({
  type: "rect",
  center: { x, y },
  width: 0.5,
  height: 0.5,
  layers: ["top"],
  connectedTo: [pcbPortId],
  circuitJsonMetadata: {
    pcb_smtpad_id: `pad_${pcbPortId}`,
    pcb_port_id: pcbPortId,
  },
})

const createConnection = (
  name: string,
  y: number,
  halfLength: number,
): SimpleRouteConnection => ({
  name,
  pointsToConnect: [
    {
      x: -halfLength,
      y,
      layer: "top",
      pointId: `${name}_start`,
      pcb_port_id: `${name}_start`,
    },
    {
      x: halfLength,
      y,
      layer: "top",
      pointId: `${name}_end`,
      pcb_port_id: `${name}_end`,
    },
  ],
})

test("the initial regional repair routes around a pad beside fixed preloaded copper", (): void => {
  // The fixed trace closes the gap above the foreign pad, so the signal has
  // to leave its straight path on the other side.
  const fixedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed_trace",
    connection_name: "fixed",
    connectsTo: ["fixed_start", "fixed_end"],
    isFixed: true,
    route: [
      { route_type: "wire", x: -2, y: 0.5, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 0.5, width: 0.1, layer: "top" },
    ],
  }
  const signal = createConnection("signal", 0, 4)
  const obstacles: Obstacle[] = [
    createPad(-4, 0, "signal_start"),
    createPad(4, 0, "signal_end"),
    createPad(-2, 0.5, "fixed_start"),
    createPad(2, 0.5, "fixed_end"),
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["foreign_pad"],
      circuitJsonMetadata: { pcb_smtpad_id: "foreign_pad" },
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -8, maxX: 8, minY: -8, maxY: 8 },
    obstacles,
    connections: [signal, createConnection("fixed", 0.5, 2)],
    traces: [fixedTrace],
  }
  const signalRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: [signal],
    newHdRoutes: [signalRoute],
    updatedPreloadedTraces: [fixedTrace],
    mutatedPreloadedTraceIds: new Set(),
    connMap,
    obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  expect(Number(solver.stats.initialJointDrcIssueCount)).toBeGreaterThan(0)
  expect(solver.movablePreloadedSections).toHaveLength(0)
  solver.solve()

  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.initialBoundedRegionalRepairSolver?.solved).toBeTrue()
  expect(solver.stats.initialBoundedRegionalRepairAccepted).toBeTrue()
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.getUpdatedPreloadedTraces()).toEqual([fixedTrace])
  const { errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: [signal],
      originalConnections: srj.connections,
      hdRoutes: solver.getOutput(),
      layerCount: srj.layerCount,
      obstacles,
      defaultViaHoleDiameter: 0.15,
      connMap,
    }),
  })
  expect(errors).toEqual([])
})
