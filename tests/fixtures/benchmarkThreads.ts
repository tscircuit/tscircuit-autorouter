import assert from "node:assert/strict"
import "../../scripts/build-solver-workers"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "../../lib"
import { solveWithProgress } from "../../scripts/benchmark/benchmark-run-task"
import type { BenchmarkTask } from "../../scripts/benchmark/benchmark-types"
import { getPipeline9LogicalStats } from "./getPipeline9LogicalStats"

const task: BenchmarkTask = {
  datasetName: "test",
  solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
  scenarioName: "thread-parity",
  sampleNumber: 1,
  threads: 2,
  scenario: {
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -3, y: -1, layer: "top" },
          { x: 3, y: -1, layer: "top" },
        ],
      },
    ],
  },
}
const serial = new Pipeline(structuredClone(task.scenario), {
  effort: 0.1,
  cacheProvider: null,
})
serial.solve()
const parallel = new Pipeline(structuredClone(task.scenario), {
  effort: 0.1,
  cacheProvider: null,
})
await solveWithProgress(task, parallel, performance.now(), {})
assert.equal(parallel.solved, true)
assert.equal(
  JSON.stringify(parallel.getOutputSimpleRouteJson()),
  JSON.stringify(serial.getOutputSimpleRouteJson()),
)
assert.deepEqual(
  getPipeline9LogicalStats(parallel.highDensityRouteSolver!.stats),
  getPipeline9LogicalStats(serial.highDensityRouteSolver!.stats),
)
assert.equal(parallel.iterations, serial.iterations)
await assert.rejects(
  solveWithProgress(
    { ...task, solverName: "unsupported" },
    parallel,
    performance.now(),
    {},
  ),
  /requires Pipeline9/,
)
// An exception after dispatch must still dispose the pool and let this process exit.
const failing = new Pipeline(structuredClone(task.scenario), {
  effort: 0.1,
  cacheProvider: null,
})
const solve = failing.solveAsync.bind(failing)
failing.solveAsync = async (runtime): Promise<void> => {
  await solve(runtime)
  throw new Error("expected failure")
}
await assert.rejects(
  solveWithProgress(task, failing, performance.now(), {}),
  /expected failure/,
)
console.log("Threaded benchmark parity and cleanup passed")
