import { expect, test } from "bun:test"
import { sample051 } from "@tscircuit/dataset-srj33-drc-failures"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

function getFailureSnapshotSvg(
  graphics: GraphicsObject,
  error: string,
): string {
  const errorLines = error.match(/.{1,76}(?:\s|$)/g)!
  const headerHeight = 54 + errorLines.length * 18
  const header = errorLines
    .map((line, index): string => {
      const escapedLine = line
        .trim()
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
      return `<text x="20" y="${30 + index * 18}" font-family="Arial, sans-serif" font-size="13" fill="#991b1b">${escapedLine}</text>`
    })
    .join("")
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    includeTextLabels: false,
  })
    .replace(/[ \t]+$/gm, "")
    .replace("<svg ", `<svg y="${headerHeight}" `)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${640 + headerHeight}" viewBox="0 0 640 ${640 + headerHeight}"><rect width="100%" height="100%" fill="white"/><g data-testid="routing-failure"><rect x="12" y="12" width="616" height="${headerHeight - 24}" rx="6" fill="#fef2f2" stroke="#b91c1c"/>${header}<text x="20" y="${headerHeight - 20}" font-family="Arial, sans-serif" font-size="13" fill="#475569">No routes generated. Highlighted pad: pcb_port_48.</text></g>${svg}</svg>`
}

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
  const terminal = solver.originalSrj.connections
    .flatMap((connection) => connection.pointsToConnect)
    .find((point) => point.pcb_port_id === "pcb_port_48")!
  const component = solver.componentDetectionSolver!
    .getOutput()
    .find((candidate) => candidate.componentId === "pcb_component_12")!
  graphics.points = []
  for (const rect of graphics.rects!) {
    if (
      Math.abs(rect.center.x - terminal.x) < 1e-6 &&
      Math.abs(rect.center.y - terminal.y) < 1e-6
    ) {
      rect.fill = "#fbbf24"
      rect.stroke = "#92400e"
      rect.label = terminal.pcb_port_id
    }
  }
  await expect(
    getFailureSnapshotSvg(graphics, solver.error!),
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
    getFailureSnapshotSvg(detail, solver.error!),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "terminal-detail" })

  // Repeated stepping must not turn a failed preflight into a solved board.
  solver.step()
  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
})
