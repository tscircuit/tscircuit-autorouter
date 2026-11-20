import { expect, test } from "bun:test"
import inputFixture from "../../fixtures/bug-reports/pipeline9-differential-pair-partial-output/input.srj.json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

const getTraceLength = (trace: SimplifiedPcbTrace): number => {
  const points = trace.route.filter(
    (point) => point.route_type === "wire" || point.route_type === "via",
  )
  return points.slice(1).reduce((length, point, index) => {
    const previous = points[index]!
    return length + Math.hypot(point.x - previous.x, point.y - previous.y)
  }, 0)
}

test("Pipeline9 snapshots the RK3506G2 DSI_D0 breakout length skew", async () => {
  const input = structuredClone(inputFixture) as SimpleRouteJson
  // The full board fixture uses two staggered DSI_D0 breakout pads.
  const pair = input.differentialPairs?.find(
    ({ connectionNames }) =>
      connectionNames[0] === "source_trace_154" &&
      connectionNames[1] === "source_trace_153",
  )
  if (!pair) throw new Error("DSI_D0 pair missing")
  const batch = new Set([
    ...pair.connectionNames,
    "source_trace_172",
    "source_trace_194",
  ])
  input.connections = input.connections.filter(({ name }) => batch.has(name))
  input.differentialPairs = [pair]

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 0.4,
  })
  solver.solve()
  expect(solver.solved).toBe(true)

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(
    routedTraces.map(({ connection_name }) => connection_name).sort(),
  ).toEqual([...batch].sort())
  const [positive, negative] = pair.connectionNames.map((name) =>
    getTraceLength(
      routedTraces.find((trace) => trace.connection_name === name)!,
    ),
  )
  const skew = Math.abs(positive! - negative!)
  const diagram = getBugReportSnapshotSvg(
    {
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    },
    { bounds: input.bounds },
  )
  const color = skew <= pair.lengthTolerance ? "#166534" : "#b91c1c"
  const skewLabel = `<text x="24" y="81" fill="${color}" font-family="Arial, sans-serif" font-size="18">DSI_D0 skew ${skew.toFixed(3)} mm / ${pair.lengthTolerance.toFixed(3)} mm limit</text>`
  await expect(
    diagram.replace("</svg>", `${skewLabel}</svg>`),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
