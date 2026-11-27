import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimplifiedPcbTrace } from "lib/types"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

function getSingleLayerTraceLength(trace: SimplifiedPcbTrace): number {
  let length = 0
  for (let i = 1; i < trace.route.length; i++) {
    const previous = trace.route[i - 1]!
    const point = trace.route[i]!
    if (previous.route_type !== "wire" || point.route_type !== "wire") {
      throw new Error("Expected a single-layer route")
    }
    length += Math.hypot(point.x - previous.x, point.y - previous.y)
  }
  return length
}

test("Pipeline9 matches a data trace to a length-bounded strobe beside fixed copper", async (): Promise<void> => {
  const srj = createPipeline9LengthMatchingPreloadedInput(4)
  const buses = [
    {
      busId: "strobe",
      connectionNames: ["b"],
      minLength: 12.1,
      maxLength: 12.3,
    },
    {
      busId: "data",
      connectionNames: ["a"],
      lengthMatchToConnectionNames: ["b"],
      maxLengthSkew: 0.05,
    },
  ]
  srj.buses = buses
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const lengths = new Map(
    routedTraces.map((trace) => [
      trace.connection_name,
      getSingleLayerTraceLength(trace),
    ]),
  )
  const strobeLength = lengths.get("b")!
  const dataLength = lengths.get("a")!
  expect(strobeLength).toBeCloseTo(12)
  expect(dataLength).toBeCloseTo(10)
  const fixedTrace = solver
    .getOutputSimpleRouteJson()
    .traces?.find((trace) => trace.pcb_trace_id === "fixed")
  expect(fixedTrace).toEqual(srj.traces![0])

  const board = {
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  expect(evaluateRelaxedDrc(board).errors).toHaveLength(0)
  await expect(
    getBugReportSnapshotSvg(board, { bounds: srj.bounds }),
  ).toMatchSvgSnapshot(import.meta.path)
})
