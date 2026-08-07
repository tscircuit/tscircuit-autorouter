import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import bugReport from "../fixtures/bug-reports/bugreport01-be84eb/bugreport01-be84eb.json" with {
  type: "json",
}

interface WireSegment {
  connectionName: string
  layer: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  width: number
}

const collectWireSegments = (
  traces: SimplifiedPcbTrace[],
  fallbackWidth: number,
): WireSegment[] => {
  const segments: WireSegment[] = []
  for (const trace of traces) {
    for (let index = 0; index < trace.route.length - 1; index += 1) {
      const start = trace.route[index]!
      const end = trace.route[index + 1]!
      if (start.route_type !== "wire" || end.route_type !== "wire") continue
      if (start.layer !== end.layer) continue
      segments.push({
        connectionName: trace.connection_name,
        layer: start.layer,
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        width: start.width ?? fallbackWidth,
      })
    }
  }
  return segments
}

// Smallest edge-to-edge gap between copper of two different electrical nets on
// the same layer. Same-net segments are allowed to touch, so they are skipped
// via the connectivity map. This mirrors how issue #1523 measured "produced
// clearance".
const minDifferentNetClearance = (
  traces: SimplifiedPcbTrace[],
  connMap: ConnectivityMap,
  fallbackWidth: number,
): number => {
  const segments = collectWireSegments(traces, fallbackWidth)
  let smallest = Number.POSITIVE_INFINITY
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const a = segments[i]!
      const b = segments[j]!
      if (a.layer !== b.layer) continue
      if (a.connectionName === b.connectionName) continue
      if (connMap.areIdsConnected(a.connectionName, b.connectionName)) continue
      const centerlineGap = minimumDistanceBetweenSegments(
        a.start,
        a.end,
        b.start,
        b.end,
      )
      const edgeGap = centerlineGap - (a.width / 2 + b.width / 2)
      if (edgeGap < smallest) smallest = edgeGap
    }
  }
  return smallest
}

// Regression test for #1523: routing the reported fixture at increasing
// defaultObstacleMargin used to leave the produced clearance flat or
// non-monotonic (0.1135 -> 0.1257 -> 0.0992 -> 0.1139 on pipeline 4). Once the
// margin reaches the segment point spacing it must not decrease as the margin
// grows, and the largest margin must produce clearly more clearance than no
// margin at all.
test("increasing defaultObstacleMargin increases produced clearance (pipeline 4)", () => {
  const baseSrj = (bugReport as { simple_route_json: SimpleRouteJson })
    .simple_route_json
  const margins = [0, 0.1, 0.2, 0.3]

  const clearances = margins.map((margin): number => {
    const srj = structuredClone(baseSrj)
    srj.defaultObstacleMargin = margin
    const solver = new AutoroutingPipelineSolver4(srj)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const connMap = getConnectivityMapFromSimpleRouteJson(srj)
    return minDifferentNetClearance(
      solver.getOutputSimpleRouteJson().traces ?? [],
      connMap,
      srj.minTraceWidth,
    )
  })

  const EPSILON = 0.01
  for (let index = 1; index < clearances.length; index += 1) {
    expect(clearances[index]!).toBeGreaterThanOrEqual(
      clearances[index - 1]! - EPSILON,
    )
  }
  expect(clearances.at(-1)! - clearances[0]!).toBeGreaterThanOrEqual(0.03)
})
