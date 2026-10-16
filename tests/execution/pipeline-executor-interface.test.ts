import { expect, mock, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { AutorouterExecutor } from "../../lib/execution/SolverExecutor"
import type { SimpleRouteJson } from "../../lib/types/srj-types"

test("an optional executor stays host-owned and does not change serial routing", (): void => {
  const executor: AutorouterExecutor = {
    execute: mock(() => Promise.reject(new Error("No task dispatch is enabled"))),
    dispose: mock(() => Promise.resolve()),
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "a",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const options = { cacheProvider: null, executor }
  const serial = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  const configured = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    options,
  )
  expect(configured.executor).toBe(executor)
  expect(options.executor).toBe(executor)
  expect(configured.opts).not.toHaveProperty("executor")
  expect(configured.getConstructorParams()[1]).not.toHaveProperty("executor")
  serial.solve()
  configured.solve()
  expect(serial.solved).toBe(true)
  expect(configured.solved).toBe(true)
  expect(JSON.stringify(configured.getOutputSimpleRouteJson())).toBe(
    JSON.stringify(serial.getOutputSimpleRouteJson()),
  )
  expect(executor.execute).not.toHaveBeenCalled()
  expect(executor.dispose).not.toHaveBeenCalled()
})
