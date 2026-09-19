import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import inputJson from "../../fixtures/bug-reports/bugreport106-pipeline9-qspi-via-pad-overlap/bugreport106-pipeline9-qspi-via-pad-overlap.srj.json"

test("Pipeline9 QSPI board after final routing", async (): Promise<void> => {
  const input = inputJson as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
  )
  solver.solve()

  // Render the completed routing candidate even when final validation rejects it.
  // This keeps the same visual test usable before and after the clearance fix.
  const expansion = solver.powerTraceExpansionSolver
  expect(expansion).toBeDefined()
  expect(expansion!.solved).toBe(true)
  expect(solver.srjWithPointPairs).toBeDefined()
  const { fixedTraces } = expansion!.inputSrj as Pipeline7PowerTraceExpansionInput
  const finalRouting: { solved: boolean; getOutput(): SimplifiedPcbTraces } =
    Reflect.get(solver, solver.pipelineDef.at(-1)!.solverName)
  expect(finalRouting.solved).toBe(true)
  const routedTraces = [
    ...fixedTraces.filter((trace) => trace.__replaces_pcb_trace_id !== undefined),
    ...finalRouting.getOutput(),
  ]

  // The overlay uses the standard benchmark relaxed DRC rules on both branches;
  // it is not a count of violations of this board's stricter via-to-pad rule.
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
