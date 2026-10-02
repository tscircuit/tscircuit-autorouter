import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 short-first is opt-in and preserves deterministic topology", () => {
  const input: SimpleRouteJson = {
    bounds: { minX: -12, maxX: 12, minY: -4, maxY: 6 },
    layerCount: 2,
    minTraceWidth: 0.2,
    obstacles: [],
    connections: [
      {
        name: "long-net",
        pointsToConnect: [
          { x: -8, y: 0, layer: "top" },
          { x: 0, y: 0, layer: "top" },
          { x: 8, y: 0, layer: "top" },
        ],
      },
      {
        name: "short-net",
        pointsToConnect: [
          { x: -1, y: 3, layer: "top" },
          { x: 1, y: 3, layer: "top" },
        ],
      },
    ],
  }
  const before = structuredClone(input)
  const control = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  const candidate = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    initialRouteOrder: "short-first",
  })
  const repeat = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    initialRouteOrder: "short-first",
  })
  control.solve()
  candidate.solve()
  repeat.solve()
  expect(control.solved).toBeTrue()
  expect(candidate.solved).toBeTrue()
  expect(repeat.solved).toBeTrue()
  const [controlParams] = control.portPointPathingSolver!.getConstructorParams()
  const [candidateParams] =
    candidate.portPointPathingSolver!.getConstructorParams()
  expect(controlParams.initialRouteOrder).toBeUndefined()
  expect(candidateParams.initialRouteOrder).toBe("short-first")
  expect(candidate.srjWithPointPairs!.connections).toEqual(
    control.srjWithPointPairs!.connections,
  )
  expect(candidate.getOutputSimplifiedPcbTraces()).toEqual(
    repeat.getOutputSimplifiedPcbTraces(),
  )
  expect(input).toEqual(before)
})
