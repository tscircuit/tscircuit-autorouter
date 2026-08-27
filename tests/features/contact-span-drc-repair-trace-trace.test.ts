import { expect, test } from "bun:test"
import {
  PostPowerDrcRepairSolver,
  hasPreservedTraceStructure,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/post-power-drc-repair-solver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("contact-span repair reroutes a crossing trace between stable anchors", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.2,
    minTraceToPadEdgeClearance: 0.1,
    minViaEdgeToPadEdgeClearance: 0.1,
    allowViaInPad: false,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: [
      {
        name: "owner_net",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
      {
        name: "foreign_net",
        pointsToConnect: [
          { x: 0, y: -2, layer: "top" },
          { x: 0, y: 2, layer: "top" },
        ],
      },
    ],
    obstacles: [],
    traces: [],
  }
  const owner: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "owner_trace",
    connection_name: "owner_net",
    route: [
      { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: -0.5, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.5, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const foreign: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "foreign_trace",
    connection_name: "foreign_net",
    route: [
      { route_type: "wire", x: 0, y: -2, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 2, width: 0.1, layer: "top" },
    ],
  }
  srj.traces = [foreign]
  const solver = new PostPowerDrcRepairSolver({
    originalSrj: srj,
    srjWithPointPairs: srj,
    traces: [owner],
    enabled: true,
    maxCandidateEvaluations: 16,
    maxLocalShiftRepairs: 0,
    maxLayerLiftRepairs: 0,
    maxContactSpanSearches: 1,
    maxContactSpanIterationsPerSearch: 50_000,
  })
  solver.solve()
  const accepted = solver.getOutput()[0]

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.initialDrcErrorCount).toBe(1)
  expect(solver.stats.finalDrcErrorCount).toBe(0)
  expect(solver.stats.finalViaInPadCount).toBe(0)
  expect(solver.stats.finalGuardErrorCount).toBe(0)
  expect(solver.stats.acceptedContactSpanRepairCount).toBe(1)
  expect(solver.stats.contactSpanSearchCount).toBe(1)
  expect(solver.stats.contactSpanSearchIterationCount).toBeGreaterThan(0)
  expect(accepted).toBeDefined()
  expect(hasPreservedTraceStructure(owner, accepted!)).toBe(true)
  expect(accepted!.route[0]).toEqual(owner.route[0])
  expect(accepted!.route.at(-1)).toEqual(owner.route.at(-1))
  expect(accepted!.route.some((point) => point.route_type === "via")).toBe(true)
})
