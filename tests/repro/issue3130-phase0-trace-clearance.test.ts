import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type WirePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>

type WireSegment = {
  traceId: string
  connectionName: string
  layer: string
  width: number
  start: WirePoint
  end: WirePoint
}

function getPointToSegmentDistance(
  point: { x: number; y: number },
  segStart: { x: number; y: number },
  segEnd: { x: number; y: number },
): number {
  const dx = segEnd.x - segStart.x
  const dy = segEnd.y - segStart.y
  const lenSq = dx * dx + dy * dy
  const u =
    lenSq > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lenSq,
          ),
        )
      : 0
  return Math.hypot(
    point.x - (segStart.x + u * dx),
    point.y - (segStart.y + u * dy),
  )
}

function getSegmentCenterlineDistance(a: WireSegment, b: WireSegment): number {
  const orient = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const properlyCrosses =
    orient(a.start, a.end, b.start) * orient(a.start, a.end, b.end) < 0 &&
    orient(b.start, b.end, a.start) * orient(b.start, b.end, a.end) < 0
  if (properlyCrosses) return 0
  return Math.min(
    getPointToSegmentDistance(a.start, b.start, b.end),
    getPointToSegmentDistance(a.end, b.start, b.end),
    getPointToSegmentDistance(b.start, a.start, a.end),
    getPointToSegmentDistance(b.end, a.start, a.end),
  )
}

test("Pipeline9 honors minTraceToPadEdgeClearance for trace-to-trace spacing without preloaded copper", async (): Promise<void> => {
  const srj = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/issue3130-usb-c-555-board.simple-route.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as SimpleRouteJson

  const requiredTraceClearance = srj.minTraceToPadEdgeClearance ?? 0
  expect(requiredTraceClearance).toBe(0.32)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces.length).toBeGreaterThanOrEqual(srj.connections.length)
  expect(solver.highDensityRouteSolver?.stats.solvedNodeCount).toBe(
    solver.highDensityRouteSolver?.stats.nodeCount,
  )
  const connMap = getConnectivityMapFromSimpleRouteJson(
    solver.srjWithPointPairs ?? srj,
  )

  const wireSegments: WireSegment[] = []
  for (const trace of routedTraces) {
    for (let i = 0; i < trace.route.length - 1; i++) {
      const start = trace.route[i]
      const end = trace.route[i + 1]
      if (
        start?.route_type === "wire" &&
        end?.route_type === "wire" &&
        start.layer === end.layer
      ) {
        wireSegments.push({
          traceId: trace.pcb_trace_id,
          connectionName: trace.connection_name,
          layer: start.layer,
          width: start.width,
          start,
          end,
        })
      }
    }
  }

  let worstDifferentNetTraceGap = Number.POSITIVE_INFINITY
  for (let i = 0; i < wireSegments.length; i++) {
    const segA = wireSegments[i]!
    for (let j = i + 1; j < wireSegments.length; j++) {
      const segB = wireSegments[j]!
      if (segA.layer !== segB.layer) continue
      if (
        segA.connectionName === segB.connectionName ||
        connMap.areIdsConnected(segA.connectionName, segB.connectionName)
      ) {
        continue
      }
      const gap =
        getSegmentCenterlineDistance(segA, segB) - (segA.width + segB.width) / 2
      if (gap < worstDifferentNetTraceGap) {
        worstDifferentNetTraceGap = gap
      }
    }
  }

  expect(worstDifferentNetTraceGap).toBeGreaterThanOrEqual(
    requiredTraceClearance - 1e-4,
  )

  const drcResult = evaluateRelaxedDrc({
    inputSrj: solver.originalSrj,
    srjWithPointPairs: solver.srjWithPointPairs ?? solver.originalSrj,
    routedTraces,
    drcOptions: {
      traceClearance: requiredTraceClearance,
      viaClearance: solver.originalSrj.minViaHoleEdgeToViaHoleEdgeClearance,
    },
  })
  const traceToTraceClearanceErrors = drcResult.errors.filter(
    (error) =>
      error.type === "pcb_trace_error" &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message.includes("too close"),
  )
  expect(traceToTraceClearanceErrors).toHaveLength(0)

  const svg = getSvgFromGraphicsObject(
    convertSrjToGraphicsObject(
      { ...srj, traces: routedTraces },
      { traceColorMode: "layer" },
    ),
    { backgroundColor: "white" },
  )
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
