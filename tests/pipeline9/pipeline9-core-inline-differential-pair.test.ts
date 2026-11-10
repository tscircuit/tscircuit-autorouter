import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import srj from "../fixtures/core-inline-differential-pair.json"

test("Pipeline9 fails on the three-header inline differential pair from core", async () => {
  const input = srj as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)

  expect(() => solver.solve()).toThrow(
    "must resolve to exactly one final point-pair connection, got 2",
  )
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)

  const graphics = convertSrjToGraphicsObject(input)
  const svg = getSvgFromGraphicsObject(
    {
      ...graphics,
      points: [],
      texts: [
        {
          x: -6,
          y: 3.5,
          text: "Unsolved: got 2 point pairs per signal",
          fontSize: 0.55,
          color: "#b91c1c",
          anchorSide: "center_left",
        },
      ],
    },
    { backgroundColor: "white" },
  )
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
