import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import srj from "./assets/OV5640-dual-camera-board-v2.srj.json" with {
  type: "json",
}

// takes 300s
test.skip("OV5640 dual camera board v2 pipeline7 fully solves", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    srj as SimpleRouteJson,
  )

  while (!solver.solved && !solver.failed) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 180_000)
