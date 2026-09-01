import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { stackSvgsVertically } from "stack-svgs"
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

const addComparisonHeading = ({
  svg,
  title,
  explanation,
}: {
  svg: string
  title: string
  explanation: string
}): string => {
  const width = Number(svg.match(/\bwidth="([^"]+)"/)?.[1] ?? 1000)
  const height = Number(svg.match(/\bheight="([^"]+)"/)?.[1] ?? 1000)
  const bodyStart = svg.indexOf(">") + 1
  const bodyEnd = svg.lastIndexOf("</svg>")
  const body = svg.slice(bodyStart, bodyEnd)
  const headingHeight = 72

  return `<svg width="${width}" height="${height + headingHeight}" viewBox="0 0 ${width} ${height + headingHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="${width / 2}" y="27" font-family="Arial, sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#121212">${title}</text><text x="${width / 2}" y="51" font-family="Arial, sans-serif" font-size="14" text-anchor="middle" fill="#333">${explanation}</text><g transform="translate(0 ${headingHeight})">${body}</g></svg>`
}

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
  const comparisonSvg = stackSvgsVertically(
    [
      addComparisonHeading({
        svg: getLastStepSvg(pipeline7.visualize()),
        title: "PIPELINE 7 BASELINE · SAME PHASE-2 SRJ · 0 VIAS",
        explanation:
          "All 5 remaining connections stay on the top layer alongside 7 preloaded traces.",
      }),
      addComparisonHeading({
        svg: getLastStepSvg(pipeline9.visualize()),
        title: "PIPELINE 9 REGRESSION · SAME PHASE-2 SRJ · 3 VIAS",
        explanation:
          "Preloaded-trace pathing changes layers unnecessarily; blue circles mark the 3 vias.",
      }),
    ],
    { normalizeSize: false },
  )
  expect(comparisonSvg).toMatchSvgSnapshot(import.meta.path)
})
