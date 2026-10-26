import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  Pipeline9HighDensityBatchSolver,
  type Pipeline9HighDensityBatchInput,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import { Pipeline9HighDensitySolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("physical validation preserves complete batch output and cloneable debug metadata in a worker", async (): Promise<void> => {
  const input: Pipeline9HighDensityBatchInput = {
    nodePortPoints: [
      {
        capacityMeshNodeId: "full-stack-free",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
        portPoints: [
          { x: -1, y: 0, z: 0, connectionName: "signal" },
          { x: 1, y: 0, z: 7, connectionName: "signal" },
        ],
      },
    ],
    fixedHdRoutes: [],
    connectivityNetMap: { net: ["signal"] },
    colorMap: { signal: "red" },
    obstacles: [],
    layerCount: 8,
    allowBlindAndBuriedVias: false,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
    maxIterations: 10000,
    physicalSrj: {
      layerCount: 8,
      minTraceWidth: 0.1,
      allowBlindAndBuriedVias: false,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      connections: [],
      obstacles: [
        {
          type: "rect",
          center: { x: 2, y: 2 },
          width: 0.5,
          height: 0.5,
          layers: ["bottom"],
          connectedTo: [],
        },
      ],
    },
  }
  const batch = new Pipeline9HighDensityBatchSolver(input)
  batch.solve()
  const expected = batch.getOutput()
  expect(expected[0]!.solved).toBe(true)
  expect(expected[0]!.routes[0]!.vias).toHaveLength(1)
  expect(structuredClone(expected)).toEqual(expected)

  const local = new Pipeline9HighDensitySolver({
    ...input,
    connMap: new ConnectivityMap(input.connectivityNetMap),
  })
  local.step()
  const regular = local.activeRegularSolver!
  expect(regular.growShrinkSolutionValidator).toBeFunction()
  local.solve()
  const debug = {
    metadata: regular.nodeSolveMetadataById,
    graphics: regular.visualize(),
  }
  expect(debug.metadata.size).toBe(1)
  expect(structuredClone(debug)).toEqual(debug)

  const runtime = createPipeline9TestRuntime(1)
  try {
    const actual = await runtime.executeAsync(
      Pipeline9HighDensityBatchSolver,
      input,
    )
    expect(actual).toEqual(expected)
    expect(structuredClone(actual)).toEqual(expected)
    const parallel = new Pipeline9HighDensitySolver({
      ...input,
      connMap: new ConnectivityMap(input.connectivityNetMap),
    })
    await parallel.solveAsync(runtime)
    expect(parallel.routes).toEqual(local.routes)
    expect(parallel.stats).toEqual(local.stats)
    expect(parallel.iterations).toBe(local.iterations)
  } finally {
    await runtime.dispose()
  }
})
