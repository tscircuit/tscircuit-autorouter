import { beforeAll, expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { Obstacle } from "lib/types"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

const boardMinimum = 0.15
let exposedWidths: number[] = []

beforeAll(async (): Promise<void> => {
  // Reduced from Clear Mouse's PAIR escape via. Board-world XY, mm; z=0 is top.
  // Core's withFixedTraces represents a diagonal 0.15mm trace end cap using
  // these two overlapping rectangles. Neither rectangle is a physical pad.
  const traceEndCaps: Obstacle[] = [
    { type: "rect", center: { x: 0, y: 0 }, width: 0.15, height: 0.15 * Math.SQRT1_2, layers: ["top"], connectedTo: ["PAIR"] },
    { type: "rect", center: { x: 0, y: 0 }, width: 0.15 * Math.SQRT1_2, height: 0.15, layers: ["top"], connectedTo: ["PAIR"] },
  ]
  const frames = []
  for (const includeEndCaps of [false, true]) {
    const solver = new TraceWidthSolver({
      hdRoutes: [{ connectionName: "PAIR", traceThickness: boardMinimum, viaDiameter: 0.6, vias: [], route: [{ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] }],
      connection: [{ name: "PAIR", nominalTraceWidth: boardMinimum, pointsToConnect: [] }],
      minTraceWidth: boardMinimum,
      layerCount: 2,
      obstacles: [
        { type: "rect", shape: "circle", center: { x: 0, y: 0 }, width: 0.6, height: 0.6, layers: ["top", "bottom"], connectedTo: ["PAIR"] },
        ...(includeEndCaps ? traceEndCaps : []),
      ],
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const route = solver.getHdRoutesWithWidths()[0]!
    const widths = route.route.filter((point) => point.x > 0.3).map((point) => point.traceThickness ?? route.traceThickness)
    if (includeEndCaps) exposedWidths = widths
    else expect(Math.min(...widths)).toBeGreaterThanOrEqual(boardMinimum)
    const graphics = solver.visualize()
    graphics.circles ??= []
    graphics.circles.push({ center: { x: 0, y: 0 }, radius: 0.3, fill: "rgba(50,100,200,0.15)", stroke: "blue", label: "0.6mm PAIR via" })
    frames.push({
      name: `${includeEndCaps ? "With trace end caps" : "Via only"}: ${Math.min(...widths).toFixed(3)}mm outside via (minimum 0.150mm)`,
      step: "end" as const,
      graphics,
    })
  }
  // Run the snapshot independently so test.failing cannot hide snapshot errors.
  await expect(getGraphicsSvgFrames({ frames, columns: 1, backgroundColor: "white" })).toMatchSvgSnapshot(import.meta.path)
})

test.failing("PAIR trace stays at the board minimum outside the terminal via", (): void => {
  expect(Math.min(...exposedWidths)).toBeGreaterThanOrEqual(boardMinimum)
})
