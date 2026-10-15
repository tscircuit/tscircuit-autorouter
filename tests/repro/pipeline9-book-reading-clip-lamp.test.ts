import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getPendingEffectsFromSolverTree } from "lib/solvers/getPendingEffectsFromSolverTree"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import capturedInput from "../../fixtures/repro/book-reading-clip-lamp/book-reading-clip-lamp.unrouted.srj.json" with { type: "json" }

// Reproduce current main's failure without preserving any published copper.
// Do not relax the board rules or replace the normal Pipeline 9 stages.
test("Pipeline 9 reproduces the placements-only reading lamp GND reachability failure", async (): Promise<void> => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  expect(input.traces).toEqual([])
  expect(input.layerCount).toBe(4)
  expect(input.allowBlindAndBuriedVias).toBe(false)
  expect(input.connections).toHaveLength(101)
  expect(input.obstacles).toHaveLength(767)
  expect(input.connections.flatMap((net) => net.pointsToConnect)).toHaveLength(450)
  expect(input.obstacles.some((obstacle) => obstacle.circuitJsonMetadata?.pcb_via_id)).toBe(false)
  expect(input.connections.some((net) => net.externallyConnectedPointIds?.length)).toBe(false)
  expect(input.obstacles.some((obstacle) => obstacle.connectedTo.some((id) => /^pcb_(trace|via)_/.test(id)))).toBe(false)

  const placementGraphics = convertSrjToGraphicsObject(input)
  placementGraphics.points = []
  expect(input.outline).toHaveLength(96)
  placementGraphics.lines.push({
    points: [...input.outline!, input.outline![0]!],
    strokeColor: "#475569",
    strokeWidth: 0.1,
    label: "Published 60 mm board outline",
  })
  await expect(
    getSvgFromGraphicsObject(placementGraphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "placements" })

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  while (!solver.solved && !solver.failed) {
    solver.step()
    const effects = getPendingEffectsFromSolverTree(solver)
    if (effects.length > 0) {
      await Promise.all(effects.map((effect) => effect.promise))
    }
  }

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.getCurrentPhase()).toBe("portPointPathingSolver")
  expect(solver.error).toBe(
    "Static reachability precheck failed: 1 route(s) have no legal path under the current reservation and start-region rules source_net_0_mst26 (pcb_port_417->pcb_port_403)",
  )
  expect(solver.highDensityRouteSolver).toBeUndefined()

  const failedPair = solver.srjWithPointPairs!.connections.find(
    (connection) => connection.name === "source_net_0_mst26",
  )!
  expect(failedPair.pointsToConnect.map((point) => point.pcb_port_id)).toEqual([
    "pcb_port_417",
    "pcb_port_403",
  ])
  // Zoom to the actual U5 footprint. The dashed line is an unrouted demand.
  const failureGraphics: GraphicsObject = {
    ...placementGraphics,
    lines: [],
    rects: placementGraphics.rects.filter(({ center }) =>
      center.x >= 10 && center.x <= 18 && center.y >= -12 && center.y <= -4,
    ),
  }
  failureGraphics.lines = [{
    points: failedPair.pointsToConnect.map(({ x, y }) => ({ x, y })),
    strokeColor: "#dc2626",
    strokeWidth: input.minTraceWidth,
    strokeDash: [14, 8],
    label: "Unrouted U5 GND: EP → GND1",
    layer: "z0",
  }]
  failureGraphics.lines.push(...failedPair.pointsToConnect.map(({ x, y }) => ({
    points: Array.from({ length: 33 }, (_, index) => ({
      x: x + 0.7 * Math.cos(index * Math.PI / 16),
      y: y + 0.7 * Math.sin(index * Math.PI / 16),
    })),
    strokeColor: "#dc2626",
    strokeWidth: 0.04,
    layer: "z0",
  })))
  await expect(
    getSvgFromGraphicsObject(failureGraphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "unreachable-gnd" })
})
