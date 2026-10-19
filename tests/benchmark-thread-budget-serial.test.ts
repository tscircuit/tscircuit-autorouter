import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../lib"
import { solveWithProgress } from "../scripts/benchmark/benchmark-run-task"
import type { BenchmarkTask } from "../scripts/benchmark/benchmark-types"

test("serial Pipeline9 accepts a routing thread budget without changing output", async (): Promise<void> => {
  const task: BenchmarkTask = {
    datasetName: "test",
    solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
    scenarioName: "serial-budget",
    sampleNumber: 1,
    threads: 4,
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
  const serial = new Pipeline9(structuredClone(task.scenario), {
    effort: 0.1,
    cacheProvider: null,
  })
  serial.solve()
  const budgeted = new Pipeline9(structuredClone(task.scenario), {
    effort: 0.1,
    cacheProvider: null,
  })
  expect("solveAsync" in budgeted).toBe(false)
  await solveWithProgress(task, budgeted, performance.now(), {})
  expect(budgeted.solved).toBe(true)
  expect(JSON.stringify(budgeted.getOutputSimpleRouteJson())).toBe(
    JSON.stringify(serial.getOutputSimpleRouteJson()),
  )
  expect(budgeted.iterations).toBe(serial.iterations)
})
