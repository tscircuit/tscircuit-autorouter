import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
} from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { stackSvgsHorizontally } from "stack-svgs"

const fixturePath =
  "../../fixtures/bug-reports/t113-linux-exact-phase10/t113-linux-exact-phase10.srj.json.gz"

const addHeading = (svg: string, heading: string): string => {
  const width = Number(svg.match(/\bwidth="([^"]+)"/)?.[1] ?? 1000)
  const height = Number(svg.match(/\bheight="([^"]+)"/)?.[1] ?? 1000)
  const bodyStart = svg.indexOf(">") + 1
  const bodyEnd = svg.lastIndexOf("</svg>")
  const headingHeight = 56
  return `<svg width="${width}" height="${height + headingHeight}" viewBox="0 0 ${width} ${height + headingHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="${width / 2}" y="34" font-family="Arial, sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="#121212">${heading}</text><g transform="translate(0 ${headingHeight})">${svg.slice(bodyStart, bodyEnd)}</g></svg>`
}

const renderPhase = (
  inputSrj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
  heading: string,
): string => {
  const graphics = convertSrjToGraphicsObject({ ...inputSrj, traces })
  graphics.points = []
  return addHeading(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
    heading,
  )
}

test(
  "routes the exact T113-S3 phase 10 without DRC errors",
  () => {
    const inputSrj = JSON.parse(
      gunzipSync(
        Uint8Array.from(readFileSync(new URL(fixturePath, import.meta.url))),
      ).toString("utf8"),
    ) as SimpleRouteJson

    expect(inputSrj.connections).toHaveLength(24)
    expect(inputSrj.obstacles).toHaveLength(387)
    expect(inputSrj.traces).toHaveLength(112)

    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(inputSrj),
      { cacheProvider: null },
    )
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.error).toBeNull()
    const routedTraces = solver.getOutputSimplifiedPcbTraces()
    const { errors } = evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    })
    expect(errors).toEqual([])

    const preloadedTraces = inputSrj.traces ?? []
    const comparisonSvg = stackSvgsHorizontally(
      [
        renderPhase(inputSrj, preloadedTraces, "EXACT T113 PHASE 10 · INPUT"),
        renderPhase(
          inputSrj,
          combinePreloadedAndRoutedTraces(preloadedTraces, routedTraces),
          "EXACT T113 PHASE 10 · ROUTED · DRC 0",
        ),
      ],
      { gap: 12, normalizeSize: false },
    ).replace(/[ \t]+$/gm, "")
    expect(comparisonSvg).toMatchSvgSnapshot(import.meta.path, {
      svgName: "unrouted-to-routed",
      tolerance: 0.02,
    })
  },
  { timeout: 180_000 },
)
