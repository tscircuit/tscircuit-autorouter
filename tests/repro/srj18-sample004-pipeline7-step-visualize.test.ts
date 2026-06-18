import { expect, test } from "bun:test"
import datasetSrj18 from "dataset-srj18"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test(
  "srj18 sample004 pipeline7 step+visualize repro currently fails on source_trace_46__source_trace_47__source_net_25_mst0 before high density",
  () => {
    const srj = (datasetSrj18.dataset ?? datasetSrj18).sample004
    const solver = new AutoroutingPipelineSolver7_MultiGraph(srj, {
      effort: 4,
    })

    const start = performance.now()

    while (
      !solver.solved &&
      !solver.failed &&
      solver.getCurrentPhase() !== "highDensityRouteSolver"
    ) {
      solver.step()
      solver.visualize()

      if (performance.now() - start > 20_000) {
        throw new Error(
          `Timed out after 20000ms at phase=${solver.getCurrentPhase()} step=${solver.iterations}`,
        )
      }
    }

    expect(solver.getCurrentPhase()).toBe("portPointPathingSolver")
    expect(solver.failed).toBe(true)
    expect(solver.highDensityRouteSolver).toBeUndefined()
    expect(solver.error).toContain(
      "source_trace_46__source_trace_47__source_net_25_mst0",
    )
    expect(solver.error).toContain("Static reachability precheck failed")
  },
  30_000,
)
