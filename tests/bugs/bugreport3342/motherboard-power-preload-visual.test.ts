import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { loadMotherboardPowerPhase } from "./repro"

test("preserves the live motherboard preload output and its visual snapshot", async (): Promise<void> => {
  const input = loadMotherboardPowerPhase()
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    effort: 1,
    cacheProvider: null,
  })
  while (
    !pipeline.preloadedTraceGraphSolver?.solved &&
    !pipeline.failed &&
    !pipeline.solved
  ) {
    pipeline.step()
  }
  expect(pipeline.failed).toBe(false)
  const preload = pipeline.preloadedTraceGraphSolver
  if (!preload?.solved)
    throw new Error(`Preload did not complete: ${pipeline.error}`)
  const output = preload.getOutput()
  // Covers every boundary, port, net ID and assignment, including details
  // too small to distinguish at the board overview's pixel resolution.
  expect(
    createHash("sha256").update(JSON.stringify(output)).digest("hex"),
  ).toBe("5b7c4a1206548fcd6fc0874726a1065cbc63b1da23c7c3f8490bb01a6a8ba713")
  expect(preload.stats).toMatchObject({
    preloadedPortCount: 3347,
    tracePortAssignmentCount: 3626,
  })
  const graphics = convertSrjToGraphicsObject(input)
  graphics.points = []
  for (const edge of output) {
    for (const port of edge.portPoints) {
      for (const assignment of port._preloadedTracePortAssignments ?? []) {
        graphics.circles.push({
          center: { x: port.x, y: port.y },
          radius: 0.18,
          fill: "#111111",
          stroke: "#ffffff",
        })
        graphics.lines.push({
          points: [{ x: port.x, y: port.y }, assignment.tracePoint],
          strokeColor: "#111111",
          strokeWidth: 0.08,
        })
      }
    }
  }
  const svg: string = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: 1200,
    svgHeight: 960,
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path, {
    scale: 1,
    tolerance: 0,
  })
})
