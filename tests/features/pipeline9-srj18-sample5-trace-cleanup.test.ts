import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 cleans SRJ18 sample 5 bends and revisits removable vias", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 5)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const vias = new Set<string>()
  let bendCount = 0
  let traceLengthMm = 0
  for (const trace of routedTraces) {
    for (let index = 0; index < trace.route.length; index++) {
      const point = trace.route[index]!
      if (point.route_type === "via") vias.add(`${point.x},${point.y}`)
      const next = trace.route[index + 1]
      if (
        point.route_type !== "wire" ||
        next?.route_type !== "wire" ||
        point.layer !== next.layer
      ) continue
      traceLengthMm += Math.hypot(next.x - point.x, next.y - point.y)
      const afterNext = trace.route[index + 2]
      if (
        afterNext?.route_type === "wire" &&
        next.layer === afterNext.layer &&
        Math.abs(
          (next.x - point.x) * (afterNext.y - next.y) -
            (next.y - point.y) * (afterNext.x - next.x),
        ) > 1e-8
      ) bendCount++
    }
  }

  // The same input on main had 146 vias, 749 bends and 1993.98 mm of copper.
  expect(vias.size).toBeLessThan(146)
  expect(bendCount).toBeLessThan(600)
  expect(traceLengthMm).toBeLessThan(1993)
  const output = {
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  expect(evaluateRelaxedDrc(output).errors).toEqual([])
  await expect(getBugReportSnapshotSvg(output)).toMatchSvgSnapshot(import.meta.path)
})
