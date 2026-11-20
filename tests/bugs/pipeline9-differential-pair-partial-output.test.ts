import { expect, test } from "bun:test"
import inputFixture from "../../fixtures/bug-reports/pipeline9-differential-pair-partial-output/input.srj.json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 preserves independent copper when the RK3506G2 display pair fails", async (): Promise<void> => {
  const input = structuredClone(inputFixture) as SimpleRouteJson
  // Route one batch on the full placement board, with all obstacles and layers.
  const dsiPositive = "source_trace_154"
  const dsiNegative = "source_trace_153"
  const uartTx = "source_trace_172"
  const ledAnode = "source_trace_194"
  const batch = new Set([dsiPositive, dsiNegative, uartTx, ledAnode])
  input.connections = input.connections.filter(({ name }) => batch.has(name))
  input.differentialPairs = input.differentialPairs?.filter(
    ({ connectionNames }) =>
      connectionNames.includes(dsiPositive) &&
      connectionNames.includes(dsiNegative),
  )
  expect(input.connections).toHaveLength(4)
  expect(input.differentialPairs).toHaveLength(1)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 0.4,
  })
  while (
    !solver.lengthMatchingPostProcessingSolver &&
    !solver.solved &&
    !solver.failed
  ) {
    solver.step()
  }

  const pairSolver = solver.lengthMatchingPostProcessingSolver
  if (!pairSolver)
    throw new Error(solver.error ?? "Display pair stage not reached")
  const cleanup = solver.effortCleanupSolver
  if (!cleanup?.solved) throw new Error("Route cleanup did not complete")
  const cleanedRoutes = cleanup.getOutput()
  expect(cleanup.params.isValid(cleanedRoutes)).toBe(true)
  const cleanedNets = new Set(
    cleanedRoutes.map(({ rootConnectionName }) => rootConnectionName),
  )
  expect(cleanedNets.has(uartTx)).toBe(true)
  expect(cleanedNets.has(ledAnode)).toBe(true)

  // Trigger a deterministic DSI_D0 failure after the real router produces copper.
  const pairError = "Controlled RK3506G2 DSI_D0 length-matching failure"
  pairSolver.error = pairError
  pairSolver.failed = true
  solver.step()

  expect(solver.getCurrentPhase()).toBe("lengthMatchingPostProcessingSolver")
  expect(solver.error).toBe(pairError)
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
    "Cannot get output before solving is complete",
  )

  const routedTraces = solver.getPartialOutputSimplifiedPcbTraces()
  expect(
    routedTraces.map(({ connection_name }) => connection_name).sort(),
  ).toEqual([uartTx, ledAnode])
  await expect(
    getBugReportSnapshotSvg(
      {
        inputSrj: input,
        srjWithPointPairs: solver.srjWithPointPairs!,
        routedTraces,
      },
      { bounds: input.bounds },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
