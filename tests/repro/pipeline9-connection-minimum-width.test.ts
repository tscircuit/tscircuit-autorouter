import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { stackSvgsVertically } from "stack-svgs"
import { getConnectionMinimumTraceWidthInput } from "../fixtures/connectionMinimumTraceWidthInput"

test("Pipeline9 finds a legal detour for an explicit connection minimum", async (): Promise<void> => {
  const input = getConnectionMinimumTraceWidthInput()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const widths = routedTraces.flatMap((trace) =>
    trace.route.flatMap((point) =>
      point.route_type === "wire" ? [point.width] : [],
    ),
  )
  expect(widths.length).toBeGreaterThan(0)
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(0.4 - 1e-6)

  const controlInput: SimpleRouteJson = { ...input, minTraceWidth: 0.4 }
  const control = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    controlInput,
    { cacheProvider: null },
  )
  control.solve()
  expect(control.solved).toBe(true)
  const controlTraces = control.getOutputSimplifiedPcbTraces()
  const controlWidths = controlTraces.flatMap((trace) =>
    trace.route.flatMap((point) =>
      point.route_type === "wire" ? [point.width] : [],
    ),
  )
  expect(controlWidths.length).toBeGreaterThan(0)
  expect(Math.min(...controlWidths)).toBeGreaterThanOrEqual(0.4 - 1e-6)

  for (const terminal of input.connections[0]!.pointsToConnect) {
    expect(
      routedTraces.some((trace) =>
        trace.route.some(
          (point) =>
            point.route_type === "wire" &&
            point.layer === terminal.layer &&
            Math.hypot(point.x - terminal.x, point.y - terminal.y) < 1e-6,
        ),
      ),
    ).toBe(true)
  }

  const panels = [
    {
      srj: input,
      solver,
      traces: routedTraces,
      label: `Explicit minimum 0.40 mm; emitted ${Math.min(...widths).toFixed(4)} mm; board minimum 0.10 mm`,
    },
    {
      srj: controlInput,
      solver: control,
      traces: controlTraces,
      label: "CONTROL: board minimum 0.40 mm; full-width detour",
    },
  ].map(({ srj, solver, traces, label }) => {
    // Reduced SRJ terminals have no Circuit JSON port records. Width and
    // endpoint joins are asserted separately; check the declared 0.13mm gap.
    const svg = getBugReportSnapshotSvg({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
      drcOptions: { includeTraceContinuity: false, traceClearance: 0.13 },
    })
    return svg.replace(
      "</svg>",
      `<text x="24" y="85" font-family="Arial, sans-serif" font-size="15" fill="black">${label}</text></svg>`,
    )
  })
  await expect(stackSvgsVertically(panels)).toMatchSvgSnapshot(import.meta.path)
})
