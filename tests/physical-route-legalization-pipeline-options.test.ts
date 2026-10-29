import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 serializable legalization options and declared clearances reach the regular grown-node solver", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.12,
    minViaEdgeToPadEdgeClearance: 0.13,
    minTraceToHoleEdgeClearance: 0.2,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "a",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const options = JSON.parse(
    JSON.stringify({
      physicalLegalizationMode: "compression-only",
      physicalLegalizationIterations: 0,
    }),
  )
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    input,
    options,
  )
  while (
    !pipeline.highDensityRouteSolver &&
    !pipeline.solved &&
    !pipeline.failed
  )
    pipeline.step()
  const hd = pipeline.highDensityRouteSolver
  if (!hd) throw new Error(`Did not reach HD construction: ${pipeline.error}`)
  const [, constructorOptions] = pipeline.getConstructorParams()
  expect(constructorOptions.physicalLegalizationMode).toBe("compression-only")
  expect(constructorOptions.physicalLegalizationIterations).toBe(0)
  hd.step()
  const regular = hd.activeRegularSolver
  if (!regular)
    throw new Error("Expected an ordinary node without fixed copper")
  expect(regular.physicalLegalizationMode).toBe("compression-only")
  expect(regular.physicalLegalizationIterations).toBe(0)
  regular.step()
  const grown = regular.activeSubSolver
  if (!(grown instanceof GrowShrinkHighDensityIntraNodeSolver))
    throw new Error("Expected the configured grow/shrink solver")
  expect(grown.constructorParams.physicalLegalizationMode).toBe(
    "compression-only",
  )
  expect(grown.constructorParams.physicalLegalizationIterations).toBe(0)
  expect(grown.constructorParams.minTraceToHoleEdgeClearance).toBe(0.2)
  expect(grown.constructorParams.minTraceToPadEdgeClearance).toBe(0.12)
  expect(grown.constructorParams.viaToPadClearance).toBe(0.13)
})
