import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import type { SimpleRouteJson } from "lib/types"
import input from "../fixtures/assets/fixed-footprint-diagonal.srj.json"

test("route R1 to R2 around a fixed 45-degree footprint trace", async (): Promise<void> => {
  const srj = structuredClone(input) as SimpleRouteJson
  const fixed = structuredClone(srj.traces![0]!)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  solver.solve()
  expect(solver.error).toContain("immutable fixed route conflict")
  expect(solver.failed).toBe(true)
  expect(srj.traces).toEqual([fixed])
  const svg = getSvgFromGraphicsObject(convertSrjToGraphicsObject(srj), {
    backgroundColor: "white",
  })
  await expect(svg.replace(/[ \t]+$/gm, "")).toMatchSvgSnapshot(
    import.meta.path,
  )
})
