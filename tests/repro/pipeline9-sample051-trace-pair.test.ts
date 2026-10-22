import { expect, test } from "bun:test"
import { sample051 } from "@tscircuit/dataset-srj33-drc-failures"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 rejects the solar charger's trapped BGA terminal", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(sample051) as unknown as SimpleRouteJson,
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()

  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
  expect(solver.error).toBe(
    'Unroutable under these constraints: connection "source_net_25" ' +
      'terminal "pcb_port_48" in BGA "pcb_component_12" on top ' +
      "has no trace escape (0.150 mm width, 0.100 mm pad clearance) " +
      "and no legal via placement (0.450 mm pad, 0.300 mm hole, " +
      "0.100 mm pad clearance).",
  )
  expect(solver.escapeViaLocationSolver).toBeUndefined()
  expect(solver.highDensityRouteSolver).toBeUndefined()

  // Retain the repro's board/detail snapshot paths so the fix shows a visual
  // before/after diff. Render the actual failed solver's input geometry.
  const graphics = solver.preprocessSimpleRouteJsonSolver!.visualize()
  const component = solver.componentDetectionSolver!
    .getOutput()
    .find((candidate) => candidate.componentId === "pcb_component_12")!
  graphics.points = []
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      includeTextLabels: false,
    }).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path)
  const detail: GraphicsObject = {
    rects: graphics.rects!.filter(
      (rect) =>
        rect.center.x >= component.bounds.minX &&
        rect.center.x <= component.bounds.maxX &&
        rect.center.y >= component.bounds.minY &&
        rect.center.y <= component.bounds.maxY,
    ),
  }
  await expect(
    getSvgFromGraphicsObject(detail, {
      backgroundColor: "white",
      includeTextLabels: false,
    }).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "terminal-detail" })

  // Repeated stepping must not turn a failed preflight into a solved board.
  solver.step()
  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
})
