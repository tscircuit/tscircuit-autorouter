import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { combinePreloadedAndRoutedTraces } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/stm32-lcd-vcap.json" with {
  type: "json",
}

test("snapshots the full STM32 LCD board with the shared VCAP ground via", async (): Promise<void> => {
  // Captured after LCD_LANES (phase 0): all pads and 16 routed bus lanes.
  const supportInput = structuredClone(
    bugReport.supportPhaseInput,
  ) as SimpleRouteJson
  const supportSolver = new AutoroutingPipelineSolver7_MultiGraph(supportInput, {
    cacheProvider: null,
  })
  supportSolver.solve()
  expect(supportSolver.failed).toBe(false)
  expect(supportSolver.solved).toBe(true)
  expect(supportInput.traces).toHaveLength(16)

  // CONTROL_POWER_DEBUG (phase 1) output becomes MCU_DATA_FANOUT (phase 2) copper.
  const fanoutInput: SimpleRouteJson = {
    ...supportInput,
    connections: bugReport.dataFanoutConnections as SimpleRouteConnection[],
    traces: combinePreloadedAndRoutedTraces(
      supportInput.traces!,
      supportSolver.getOutputSimplifiedPcbTraces(),
    ),
  }
  const fanoutSolver = new AutoroutingPipelineSolver7_MultiGraph(fanoutInput, {
    cacheProvider: null,
  })
  fanoutSolver.solve()
  expect(fanoutSolver.failed).toBe(false)
  expect(fanoutSolver.solved).toBe(true)
  const fanoutTraces = fanoutSolver.getOutputSimplifiedPcbTraces()
  expect(fanoutTraces).toHaveLength(16)

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: {
        ...fanoutInput,
        connections: [...supportInput.connections, ...fanoutInput.connections],
      },
      srjWithPointPairs: {
        ...fanoutSolver.srjWithPointPairs!,
        connections: [
          ...supportSolver.srjWithPointPairs!.connections,
          ...fanoutSolver.srjWithPointPairs!.connections,
        ],
      },
      routedTraces: fanoutTraces,
    }).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path)
})
