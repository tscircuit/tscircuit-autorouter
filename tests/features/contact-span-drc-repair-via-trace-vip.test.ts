import { expect, test } from "bun:test"
import { runContactSpanDrcRepairPass } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/contact-span-drc-repair"
import {
  PostPowerDrcRepairSolver,
  hasPreservedTraceStructure,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/post-power-drc-repair-solver"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"

type EvaluationSummary = {
  errorIds: string[]
  viaInPadIds: string[]
  guardErrorIds: string[]
}

test("contact-span repair escapes a via from a same-net pad and a foreign trace", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.2,
    minTraceToPadEdgeClearance: 0.1,
    minViaEdgeToPadEdgeClearance: 0.1,
    allowViaInPad: false,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -4, minY: -4, maxX: 4, maxY: 4 },
    connections: [
      {
        name: "owner_net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "owner_start" },
          { x: 2, y: 0, layer: "bottom", pcb_port_id: "owner_end" },
        ],
      },
      {
        name: "foreign_net",
        pointsToConnect: [
          { x: -1, y: 0.29, layer: "top" },
          { x: 1, y: 0.29, layer: "top" },
        ],
      },
    ],
    obstacles: [
      {
        obstacleId: "owner_pad",
        obstacleRole: "pad",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1.2,
        height: 0.2,
        connectedTo: ["owner_net", "owner_start"],
      },
    ],
    traces: [],
  }
  const owner: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "owner_trace",
    connection_name: "owner_net",
    connectsTo: ["owner_start", "owner_end"],
    route: [
      {
        route_type: "wire",
        x: 0,
        y: 0,
        width: 0.1,
        layer: "top",
        start_pcb_port_id: "owner_start",
      },
      { route_type: "wire", x: 0.3, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: 0.3,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
        via_hole_diameter: 0.2,
      },
      { route_type: "wire", x: 0.3, y: 0, width: 0.1, layer: "bottom" },
      {
        route_type: "wire",
        x: 2,
        y: 0,
        width: 0.1,
        layer: "bottom",
        end_pcb_port_id: "owner_end",
      },
    ],
  }
  const foreign: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "foreign_trace",
    connection_name: "foreign_net",
    route: [
      { route_type: "wire", x: -1, y: 0.29, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0.29, width: 0.1, layer: "top" },
    ],
  }
  const traces = [owner, foreign]
  const oracle = new PostPowerDrcRepairSolver({
    originalSrj: srj,
    srjWithPointPairs: srj,
    traces,
    enabled: true,
    maxCandidateEvaluations: 0,
  })
  const evaluate = (
    oracle as unknown as {
      evaluate: (candidateTraces: SimplifiedPcbTraces) => EvaluationSummary
    }
  ).evaluate.bind(oracle)
  const before = evaluate(traces)
  expect(before.errorIds).toHaveLength(1)
  expect(before.viaInPadIds).toHaveLength(1)

  let accepted: SimplifiedPcbTrace | undefined
  const stats = runContactSpanDrcRepairPass({
    srj,
    traces,
    fixedTraces: [],
    connectivityMap: oracle.supplementalConnMap,
    conflicts: [
      {
        identity: before.viaInPadIds[0]!,
        center: { x: 0.3, y: 0 },
        ownerTraceIds: [owner.pcb_trace_id],
      },
    ],
    getAllowedLayers: (): string[] => ["top", "inner1", "inner2", "bottom"],
    acceptCandidate: (candidate): boolean => {
      const after = evaluate([candidate, foreign])
      if (
        after.errorIds.length > 0 ||
        after.viaInPadIds.length > 0 ||
        after.guardErrorIds.length > 0
      ) {
        return false
      }
      accepted = candidate
      return true
    },
    maxSearches: 1,
    maxIterationsPerSearch: 50_000,
  })

  expect(stats.accepted).toBe(true)
  expect(stats.searchCount).toBe(1)
  expect(stats.searchIterationCount).toBeGreaterThan(0)
  expect(accepted).toBeDefined()
  expect(hasPreservedTraceStructure(owner, accepted!)).toBe(true)
  expect(
    accepted!.route.some(
      (point) =>
        point.route_type === "jumper" ||
        point.route_type === "through_obstacle",
    ),
  ).toBe(false)
})
