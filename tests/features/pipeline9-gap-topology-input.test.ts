import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import scenario from "./preexisting-connected-traces/srj/preexisting-connected-traces06.srj.json"

test("Pipeline9 only combines gap layers when its topology includes all copper", (): void => {
  const inputSrj: SimpleRouteJson = structuredClone(scenario)
  inputSrj.minViaPadDiameter = 0.5
  for (const traces of [undefined, [], inputSrj.traces]) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      { ...structuredClone(inputSrj), traces },
      { cacheProvider: null, effort: 1 },
    )
    solver.solveUntilPhase("edgeSolver")

    expect(solver.failed).toBe(false)
    const gapFillSolver =
      solver.topologyPlanningSolver?.globalTopologySolver?.gapFillSolver
    expect(gapFillSolver?.solved).toBe(true)
    expect(gapFillSolver?.inputProblem.viaDiameter).toBe(0.5)
    expect(gapFillSolver?.inputProblem.mergeGapFillLayers).toBe(!traces?.length)
    if (traces?.length) {
      const expandedNodes = gapFillSolver!
        .getOutput()
        .outputNodes.slice(gapFillSolver!.inputProblem.meshNodes.length)
      expect(expandedNodes.length).toBeGreaterThan(0)
      expect(
        expandedNodes.every((node): boolean => node.availableZ.length === 1),
      ).toBe(true)
    }
  }
})
