import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { copperPourReservationInput } from "./fixtures/copper-pour-reservations"

test("joint indexed and reference repair candidates reject inner signal copper with native antipads intact", (): void => {
  const input = copperPourReservationInput()
  const original = JSON.stringify(input)
  const initial: HighDensityRoute = {
    connectionName: "DATA", rootConnectionName: "DATA", traceThickness: 0.1, viaDiameter: 0.3,
    startPcbPortId: "pcb_port_signal_0", endPcbPortId: "pcb_port_signal_1",
    route: [
      { x: -3, y: 0, z: 0, pcb_port_id: "pcb_port_signal_0" },
      { x: -2, y: 0, z: 0 }, { x: -2, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 }, { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0, pcb_port_id: "pcb_port_signal_1" },
    ], vias: [{ x: -2, y: 0 }, { x: 2, y: 0 }],
  }
  const solver = new Pipeline9JointDrcRepairSolver({
    srj: input, srjWithPointPairs: input, originalSrj: input, newConnections: [input.connections[0]!],
    newHdRoutes: [initial], updatedPreloadedTraces: [], mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(input), obstacles: input.obstacles,
    layerCount: 4, defaultViaDiameter: 0.3, defaultViaHoleDiameter: 0.15, effort: 1, colorMap: {},
  })
  const evaluator = solver.exactRepairSolver?.params.drcEvaluator
  expect(evaluator).toBeDefined()
  const candidate = (z: number): HighDensityRoute => ({
    ...initial,
    route: [initial.route[0]!, { x: -2, y: 0, z: 0 }, { x: -2, y: 0, z },
      { x: 2, y: 0, z }, { x: 2, y: 0, z: 0 }, initial.route.at(-1)!],
    vias: [{ x: -2, y: 0 }, { x: 2, y: 0 }],
  })
  const inner = candidate(1)
  const innerResult = evaluator!({ traces: [], routes: [inner], hdRoutes: [inner] })
  const innerErrors = Array.isArray(innerResult) ? innerResult : innerResult.errors
  expect(innerErrors.some(error => String(error.message).includes("copper-pour reservation"))).toBe(true)
  const surface = candidate(3)
  const surfaceResult = evaluator!({ traces: [], routes: [surface], hdRoutes: [surface] })
  const surfaceErrors = Array.isArray(surfaceResult) ? surfaceResult : surfaceResult.errors
  expect(surfaceErrors).toEqual([])
  expect(input.layerCount).toBe(4)
  expect(JSON.stringify(input)).toBe(original)
  expect(inner.route).toEqual(candidate(1).route)
})
