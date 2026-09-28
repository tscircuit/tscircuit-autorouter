import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { stackSvgsVertically } from "stack-svgs"
import srjJson from "../../fixtures/bug-reports/bugreport102-qfp16-pipeline9-extra-vias/bugreport102-qfp16-pipeline9-extra-vias.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = srjJson as SimpleRouteJson

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

test("bugreport102 compares Pipeline 7 and Pipeline 9 QFP16 routing", () => {
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
  expect(
    pipeline9
      .getOutputSimplifiedPcbTraces()
      .flatMap((trace) => trace.route)
      .filter((point) => point.route_type === "via"),
  ).toHaveLength(1)
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
        title: "PIPELINE 9 · SAME PHASE-2 SRJ · 1 VIA",
        explanation:
          "Same-net fanout simplification removes two unnecessary vias; one layer transition remains.",
      }),
    ],
    { normalizeSize: false },
  )
  expect(comparisonSvg).toMatchSvgSnapshot(import.meta.path)
})
