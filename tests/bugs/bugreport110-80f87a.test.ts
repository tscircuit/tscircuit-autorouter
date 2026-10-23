import { expect, test } from "bun:test"
import type { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getPendingEffectsFromSolverTree } from "lib/solvers/getPendingEffectsFromSolverTree"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport110-80f87a/bugreport110-80f87a.json" with {
  type: "json",
}

test("bugreport110: simplifies flex sensor traces without changing terminals or DRC", async (): Promise<void> => {
  const input = structuredClone(bugReport.simple_route_json) as SimpleRouteJson
  const baseline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  const step = baseline.pipelineDef.find(
    (step) => step.solverName === "traceSimplificationSolver",
  )!
  const getConstructorParams = step.getConstructorParams
  step.getConstructorParams = (
    pipeline,
  ): ConstructorParameters<typeof TraceSimplificationSolver> => {
    const [params] = getConstructorParams(
      pipeline,
    ) as ConstructorParameters<typeof TraceSimplificationSolver>
    return [
      {
        ...params,
        enableVertexShortcuts: false,
        useTraceWidthAwareClearance: false,
      },
    ]
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  for (const pipeline of [baseline, solver]) {
    while (!pipeline.solved && !pipeline.failed) {
      pipeline.step()
      const effects = getPendingEffectsFromSolverTree(pipeline)
      if (effects.length > 0) {
        await Promise.all(effects.map((effect) => effect.promise))
      }
    }
    expect(pipeline.failed, pipeline.error ?? "").toBe(false)
    expect(pipeline.solved).toBe(true)
  }
  const baselineTraces = baseline.getOutputSimplifiedPcbTraces()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces.flatMap((trace) => trace.route).length).toBeLessThan(
    baselineTraces.flatMap((trace) => trace.route).length,
  )
  expect(routedTraces.map((trace) => trace.pcb_trace_id)).toEqual(
    baselineTraces.map((trace) => trace.pcb_trace_id),
  )
  for (const [index, trace] of routedTraces.entries()) {
    const original = baselineTraces[index]!
    expect(trace.connectsTo).toEqual(original.connectsTo)
    expect(trace.route[0]).toEqual(original.route[0])
    expect(trace.route.at(-1)).toEqual(original.route.at(-1))
    expect(
      new Set(
        trace.route.flatMap((point) =>
          point.route_type === "wire" ? [point.width] : [],
        ),
      ),
    ).toEqual(
      new Set(
        original.route.flatMap((point) =>
          point.route_type === "wire" ? [point.width] : [],
        ),
      ),
    )
  }
  expect(
    routedTraces
      .flatMap((trace) => trace.route)
      .filter((point) => point.route_type === "via").length,
  ).toBeLessThanOrEqual(
    baselineTraces
      .flatMap((trace) => trace.route)
      .filter((point) => point.route_type === "via").length,
  )
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }).errors,
  ).toEqual(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: baseline.srjWithPointPairs!,
      routedTraces: baselineTraces,
    }).errors,
  )
  expect(input).toEqual(bugReport.simple_route_json)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
