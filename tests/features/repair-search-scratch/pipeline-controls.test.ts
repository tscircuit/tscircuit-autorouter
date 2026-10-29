import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 scratch selection requires literal true and preserves synthetic output and iteration controls", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1, minViaPadDiameter: 0.3,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [],
    connections: [{ name: "signal", pointsToConnect: [
      { x: -1, y: 0, layer: "top" }, { x: 1, y: 0, layer: "top" },
    ] }],
  }
  let expected: SimpleRouteJson | undefined, expectedIterations: number | undefined
  for (const flag of [undefined, false, true, "true", 1]) {
    const options = flag === undefined ? { cacheProvider: null } : {
      cacheProvider: null, experimentRepairSearchScratch: flag as boolean,
    }
    const solver = new Pipeline9(structuredClone(input), options)
    solver.solve()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    if (expected === undefined) { expected = solver.getOutputSimpleRouteJson(); expectedIterations = solver.iterations }
    expect(solver.getOutputSimpleRouteJson()).toEqual(expected!)
    expect(solver.iterations).toBe(expectedIterations!)
    const ledger = solver.pipeline9JointDrcRepairSolver?.repairSearchScratchStats
    expect(ledger !== undefined).toBe(flag === true)
    if (ledger) expect(Object.values(ledger).every(value => Number.isSafeInteger(value) && value >= 0)).toBeTrue()
  }
})
