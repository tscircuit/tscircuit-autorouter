import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
} from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import bugReport from "../../fixtures/bug-reports/bugreport111-0535ad/bugreport111-0535ad.json" with {
  type: "json",
}

test("bugreport111: Pipeline 9 routes GND around fixed traces that end on fully routed pads", async (): Promise<void> => {
  const input = structuredClone(bugReport.simple_route_json) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const expectedPairs = solver
    .srjWithPointPairs!.connections.map((connection) =>
      connection.pointsToConnect.map((point) => point.pcb_port_id!).sort(),
    )
    .sort()
  const routedPairs = routedTraces
    .map((trace) => [...trace.connectsTo!].sort())
    .sort()
  expect(routedPairs).toEqual(expectedPairs)
  // Native routing can produce different valid route variants across platforms.
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    snapshotPath,
  )

  // The crystal corner, board-world mm (+X right, +Y up): the hub IC's pin
  // row on the left, the crystal and its two load capacitors on the right.
  const frame = { minX: 1.4, maxX: 7.6, minY: -1.4, maxY: 7.4 }
  const isInFrame = (point: { x: number; y: number }): boolean =>
    point.x >= frame.minX &&
    point.x <= frame.maxX &&
    point.y >= frame.minY &&
    point.y <= frame.maxY
  const fixedTraceIds = input.traces!.map((trace) => trace.pcb_trace_id)
  const fixedTraceErrors = evaluateRelaxedDrc(
    snapshotInput,
  ).locationAwareErrors.filter((error) => {
    const serializedError = JSON.stringify(error)
    return fixedTraceIds.some((traceId) =>
      new RegExp(`${traceId}(?![0-9])`).test(serializedError),
    )
  })
  expect(fixedTraceErrors.every((error) => isInFrame(error.center))).toBe(true)
  // Draw only the copper inside the frame so the picture keeps one scale.
  const tracesInFrame = combinePreloadedAndRoutedTraces(
    input.traces!,
    routedTraces,
  ).flatMap((trace): SimplifiedPcbTrace[] => {
    const runs: SimplifiedPcbTrace["route"][] = [[]]
    for (const point of trace.route) {
      if ("x" in point && isInFrame(point)) {
        runs.at(-1)!.push(point)
      } else if (runs.at(-1)!.length > 0) {
        runs.push([])
      }
    }
    return runs
      .filter((run) => run.length > 0)
      .map((route, runIndex) => ({
        ...trace,
        pcb_trace_id: `${trace.pcb_trace_id}_run${runIndex}`,
        route,
      }))
  })
  const graphics = convertSrjToGraphicsObject({
    ...input,
    connections: [],
    obstacles: input.obstacles.filter((obstacle) => isInFrame(obstacle.center)),
    traces: tracesInFrame,
  })
  graphics.points = fixedTraceErrors.map(({ center, message }) => ({
    ...center,
    label: message,
  }))
  graphics.rects.push({
    center: {
      x: (frame.minX + frame.maxX) / 2,
      y: (frame.minY + frame.maxY) / 2,
    },
    width: frame.maxX - frame.minX,
    height: frame.maxY - frame.minY,
    fill: "none",
    stroke: "#94a3b8",
  })
  const color = fixedTraceErrors.length === 0 ? "#166534" : "#b91c1c"
  const overlay = `<style>circle[data-type="point"]{r:5px;fill:white;fill-opacity:0.35;stroke:#5b21b6;stroke-width:2}</style><rect x="12" y="12" width="500" height="44" rx="6" fill="white" stroke="${color}"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="${color}">Relaxed DRC errors on the fixed crystal traces: ${fixedTraceErrors.length}</text>`
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }).replace(
      "</svg>",
      `${overlay}</svg>`,
    ),
  ).toMatchSvgSnapshot(snapshotPath, { svgName: "crystal-corner" })
})
