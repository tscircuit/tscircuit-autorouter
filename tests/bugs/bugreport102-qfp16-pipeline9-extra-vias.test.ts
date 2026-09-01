import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import srjJson from "../../fixtures/bug-reports/bugreport102-qfp16-pipeline9-extra-vias/bugreport102-qfp16-pipeline9-extra-vias.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = srjJson as SimpleRouteJson

const countVias = (traces: SimplifiedPcbTraces): number =>
  traces.reduce(
    (viaCount, trace) =>
      viaCount +
      trace.route.filter((routePoint) => routePoint.route_type === "via").length,
    0,
  )

test("bugreport102 reproduces Pipeline 9 extra vias on the QFP16 phase-2 SRJ", () => {
  const pipeline7 = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  const pipeline9 = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )

  pipeline7.solve()
  pipeline9.solve()

  const pipeline7Traces = pipeline7.getOutputSimplifiedPcbTraces()
  const pipeline9Traces = pipeline9.getOutputSimplifiedPcbTraces()
  const pipeline9OutputSrj = pipeline9.getOutputSimpleRouteJson()

  expect(srj.connections).toHaveLength(5)
  expect(srj.traces).toHaveLength(7)
  expect(pipeline7.solved).toBe(true)
  expect(pipeline7.failed).toBe(false)
  expect(countVias(pipeline7Traces)).toBe(0)
  expect(
    pipeline7.portPointPathingSolver?.stats.candidatePortfolioPrimarySummary
      ?.layerChangeCount,
  ).toBe(0)
  expect(pipeline9.solved).toBe(true)
  expect(pipeline9.failed).toBe(false)
  expect(pipeline9Traces).toHaveLength(5)
  expect(pipeline9OutputSrj.traces).toHaveLength(12)
  expect(countVias(pipeline9Traces)).toBe(3)
  expect(pipeline9.portPointPathingSolver?.stats.preloadedFixedSegmentCount).toBe(
    7,
  )
  expect(
    pipeline9.portPointPathingSolver?.stats.candidatePortfolioPrimarySummary
      ?.layerChangeCount,
  ).toBe(2)
  expect(pipeline9.highDensityRouteSolver?.stats.fallbackNodeCount).toBe(0)
  expect(
    pipeline9.pipeline9JointDrcRepairSolver?.stats.initialJointDrcIssueCount,
  ).toBe(0)
  expect(getLastStepSvg(pipeline9.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
