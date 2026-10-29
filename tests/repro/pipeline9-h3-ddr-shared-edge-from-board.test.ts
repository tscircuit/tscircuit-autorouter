import { expect, test } from "bun:test"
import { sample001 } from "@tscircuit/dataset-srj36-real-ddr"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test.failing(
  "original H3 DDR circuit reaches and repairs the displaced shared edge",
  async (): Promise<void> => {
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(sample001) as unknown as SimpleRouteJson,
      { effort: 1, cacheProvider: null },
    )
    // Start with the complete board. No substituted stage output or local nodes.
    while (
      !pipeline.solved &&
      !pipeline.failed &&
      !pipeline.uniformPortDistributionSolver?.solved
    ) {
      pipeline.step()
    }
    expect(pipeline.failed, pipeline.error ?? "").toBeFalse()
    const stage = pipeline.uniformPortDistributionSolver!
    expect(stage.solved).toBeTrue()
    await expect(
      getSvgFromGraphicsObject(stage.visualize(), { backgroundColor: "white" }),
    ).toMatchSvgSnapshot(import.meta.path)
    const key = "cmn_21|cmn_9"
    const edge = stage.mapOfOwnerPairToSharedEdge.get(key)!
    expect(edge).toBeDefined()
    expect(edge.length).toBeCloseTo(0.4, 8)

    const family = stage.mapOfOwnerPairToPortPoints.get(key)!
    expect(family).toHaveLength(5)
    const ports = family.toSorted((a, b) => a.y - b.y)
    for (const [index, port] of ports.entries()) {
      expect(port.x).toBeCloseTo(edge.x1, 8)
      if (index > 0) {
        expect(port.y - ports[index - 1]!.y).toBeCloseTo(0.08, 8)
      }
    }
  },
)
