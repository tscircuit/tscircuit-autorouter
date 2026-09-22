import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import board from "../../fixtures/bug-reports/bugreport108-am3352-four-layer/am3352-four-layer.srj.json" with {
  type: "json",
}

// This reproduces the current routing failure, not a successfully routed board.
// Run with --timeout 9999999; a fresh solve currently takes about three minutes.
test("bugreport108 AM3352 reproduces the Pipeline9 high-density routing failure", async (): Promise<void> => {
  const input = structuredClone(board) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  console.info({
    elapsedMs: solver.timeToSolve,
    phase: solver.getCurrentPhase(),
    error: solver.error,
  })

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.getCurrentPhase()).toBe("highDensityRouteSolver")
  expect(solver.error).toContain("Failed to solve 1 nodes, topology_merge_3012")
  expect(solver.error).toContain("failed after resizing to 8x")
  const failedStage = solver.highDensityRouteSolver!
  expect(failedStage.failed).toBe(true)
  const failedNode = solver.highDensityNodePortPoints!.find(
    (node) => node.capacityMeshNodeId === "topology_merge_3012",
  )
  expect(failedNode).toBeDefined()
  const boardGraphics = convertSrjToGraphicsObject(input)
  const partialRouting = failedStage.visualize()
  const svg = getSvgFromGraphicsObject({
    ...boardGraphics,
    // Terminal debug dots obscure the BGA pads; the pad obstacles remain visible.
    points: [],
    lines: [...boardGraphics.lines, ...(partialRouting.lines ?? [])],
    circles: [...boardGraphics.circles, ...(partialRouting.circles ?? []), {
      center: failedNode!.center,
      radius: 1.2,
      fill: "rgba(124, 58, 237, 0.15)",
      stroke: "#7c3aed",
      label: "Failed region locator (not the region boundary)",
    }],
    rects: [...boardGraphics.rects, {
      center: failedNode!.center,
      width: failedNode!.width,
      height: failedNode!.height,
      fill: "rgba(185, 28, 28, 0.18)",
      stroke: "#b91c1c",
      label: "topology_merge_3012: original failed region",
    }],
  }, {
    backgroundColor: "white",
    svgWidth: 1000,
    svgHeight: 900,
  })
  // Reserve a header above the drawing instead of covering the board geometry.
  const failureLabel = `<rect x="12" y="12" width="976" height="76" rx="6" fill="white" stroke="#b91c1c"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="#b91c1c">AM3352 / Pipeline 9: FAILED — incomplete routing</text><text x="24" y="66" font-family="Arial, sans-serif" font-size="16" fill="#b91c1c">Purple circle: topology_merge_3012 could not route after expansion to 8x</text>`
  const snapshot = `<svg width="1000" height="1000" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>${svg.replace("<svg ", '<svg y="100" ')}<g data-testid="routing-failure">${failureLabel}</g></svg>`
  await expect(snapshot).toMatchSvgSnapshot(import.meta.path)
})
