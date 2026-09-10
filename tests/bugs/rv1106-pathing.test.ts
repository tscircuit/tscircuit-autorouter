import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import input from "./assets/rv1106-pathing/input.json"

test(
  "Pipeline9 routes the RV1106 graph from the original board input",
  async (): Promise<void> => {
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(input) as SimpleRouteJson,
      { cacheProvider: null },
    )
    while (!pipeline.portPointPathingSolver?.solved && !pipeline.failed) {
      pipeline.step()
    }
    const pathing = pipeline.portPointPathingSolver!
    expect(pipeline.failed).toBe(false)
    expect(pathing.failed).toBe(false)
    expect(pathing.solved).toBe(true)
    expect(pipeline.highDensityRouteSolver).toBeUndefined()
    await expect(getLastStepSvg(pathing.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
)
