import { sample001 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline 10 fails closed when a fanout via crosses inner copper", () => {
  const input = structuredClone(sample001) as SimpleRouteJson
  input.layerCount = 4
  input.allowBlindAndBuriedVias = false
  input.connections = input.connections.slice(0, 1)
  input.buses = []
  input.differentialPairs = []
  input.obstacles.push({
    type: "rect",
    layers: ["inner2"],
    center: { x: 0, y: 0 },
    width: 100,
    height: 100,
    connectedTo: [],
    obstacleId: "fanout-through-via-blocker",
  })
  const pipeline = new AutoroutingPipelineSolver10_BgaFanout(input, {
    cacheProvider: null,
  })

  pipeline.solveUntilStage("secondBgaFanoutSolver")

  expect(pipeline.solved).toBe(false)
  expect(pipeline.failed).toBe(true)
  expect(pipeline.getCurrentStageName()).toBe("firstBgaFanoutSolver")
  expect(pipeline.error).toContain(
    "collides with obstacle fanout-through-via-blocker on inner2",
  )
  expect(() => pipeline.firstBgaFanoutSolver!.getOutput()).toThrow(
    "Cannot get fanout output before solving",
  )
  expect(() => pipeline.getOutputSimpleRouteJson()).toThrow(
    "Pipeline 10 has not solved yet",
  )
})
