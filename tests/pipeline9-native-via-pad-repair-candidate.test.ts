import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { copperPourReservationInput } from "./fixtures/copper-pour-reservations"

test("joint indexed and reference candidate evaluations retain native via-pad clearance", (): void => {
  const input = copperPourReservationInput()
  input.minTraceToPadEdgeClearance = 0.05
  input.minViaEdgeToPadEdgeClearance = 0.15
  const pad = input.obstacles[2]!
  pad.shape = "circle"
  pad.width = 0.4
  pad.height = 0.4
  pad.circuitJsonMetadata = { pcb_smtpad_id: "pcb_smtpad_ground", pcb_port_id: "pcb_port_ground" }
  const original = JSON.stringify(input)
  const candidate = (y: number): HighDensityRoute => ({
    connectionName: "DATA", rootConnectionName: "DATA", traceThickness: 0.1, viaDiameter: 0.3,
    startPcbPortId: "pcb_port_signal_0", endPcbPortId: "pcb_port_signal_1",
    route: [
      { x: -3, y: 0, z: 0, pcb_port_id: "pcb_port_signal_0" },
      { x: -2, y: 0, z: 0 }, { x: -2, y: 0, z: 3 },
      { x: 0, y, z: 3 }, { x: 0, y, z: 0 },
      { x: 1, y: 0.7, z: 0 }, { x: 3, y: 0, z: 0, pcb_port_id: "pcb_port_signal_1" },
    ], vias: [{ x: -2, y: 0 }, { x: 0, y }],
  })
  const solver = new Pipeline9JointDrcRepairSolver({
    srj: input, srjWithPointPairs: input, originalSrj: input, newConnections: [input.connections[0]!],
    newHdRoutes: [candidate(0.46)], updatedPreloadedTraces: [], mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(input), obstacles: input.obstacles,
    layerCount: 4, defaultViaDiameter: 0.3, defaultViaHoleDiameter: 0.15, effort: 1, colorMap: {},
  })
  const indexedEvaluator = solver.exactRepairSolver?.params.drcEvaluator
  expect(indexedEvaluator).toBeDefined()
  const bad = candidate(0.46)
  const badResult = indexedEvaluator!({ traces: [], routes: [bad], hdRoutes: [bad] })
  const errors = Array.isArray(badResult) ? badResult : badResult.errors
  expect(errors.some(error => error.type === "pcb_pad_pad_clearance_error" && error.minimum_clearance === 0.15)).toBe(true)
  const safe = candidate(0.51)
  const safeResult = indexedEvaluator!({ traces: [], routes: [safe], hdRoutes: [safe] })
  expect(Array.isArray(safeResult) ? safeResult : safeResult.errors).toEqual([])
  expect(JSON.stringify(input)).toBe(original)
})
