import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type {
  PostRoutingOptimizationInput,
  PostRoutingOptimizationOptions,
} from "lib/solvers/PostRoutingOptimization/optimizePostRouting"

export function wireTrace(
  id: string,
  net: string,
  points: [number, number][],
  width = 0.4,
  layer = "top",
): SimplifiedPcbTrace {
  return {
    type: "pcb_trace",
    pcb_trace_id: id,
    connection_name: net,
    route: points.map(([x, y]) => ({ route_type: "wire", x, y, layer, width })),
  }
}

/** Synthetic two-net board; offsets/widths exercise coordinate and rule changes. */
export function boardFixture(
  offset = 0,
  width = 0.4,
): PostRoutingOptimizationInput {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    nominalTraceWidth: width,
    minTraceToPadEdgeClearance: 0.2,
    minBoardEdgeClearance: 0.2,
    minViaPadDiameter: 0.6,
    minViaHoleDiameter: 0.3,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.25,
    bounds: { minX: offset - 3, maxX: offset + 13, minY: -4, maxY: 8 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: offset, y: 0, layer: "top", pointId: "a" },
          { x: offset + 10, y: 0, layer: "top", pointId: "b" },
        ],
      },
      {
        name: "fixed",
        pointsToConnect: [
          { x: offset, y: -2, layer: "top", pointId: "c" },
          { x: offset + 10, y: -2, layer: "top", pointId: "d" },
        ],
      },
    ],
    obstacles: [],
  }
  srj.obstacles = srj.connections.flatMap((c) =>
    c.pointsToConnect.map((p) => ({
      type: "rect" as const,
      center: { x: p.x, y: p.y },
      width: 0.8,
      height: 0.6,
      ccwRotationDegrees: 15,
      layers: ["top"],
      connectedTo: [p.pointId!],
    })),
  )
  return {
    srj,
    traces: [
      wireTrace(
        "old-signal",
        "signal-pair",
        [
          [offset, 0],
          [offset, 5],
          [offset + 10, 5],
          [offset + 10, 0],
        ],
        width,
      ),
      wireTrace(
        "dynamic:fixed:0",
        "fixed-pair",
        [
          [offset, -2],
          [offset + 10, -2],
        ],
        width,
      ),
    ],
    traceOwners: new Map([
      ["signal-pair", "signal"],
      ["fixed-pair", "fixed"],
    ]),
  }
}

export function phaseOptions(): PostRoutingOptimizationOptions {
  return {
    enabled: true,
    nets: [
      {
        net: "signal",
        maxNewVias: 0,
        maxNewViasPerBranch: 0,
        componentPlanning: "zero-via-forest",
      },
    ],
    objective: {
      priorities: ["viaSites", "copperLength", "bends"],
      maxCopperLengthIncrease: 0,
      maxBendIncrease: 0,
      maxChangedNets: 1,
    },
    search: {
      gridStep: 0.5,
      viaCost: 3,
      bendCost: 0.05,
      maxExpansions: 300_000,
      maxMilliseconds: 10_000,
    },
  }
}
