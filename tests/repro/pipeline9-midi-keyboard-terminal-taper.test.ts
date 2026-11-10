import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getPendingEffectsFromSolverTree } from "lib/solvers/getPendingEffectsFromSolverTree"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { isPointInRect } from "lib/utils/isPointInRect"

test("snapshots live terminal tapers on the complete real MIDI keyboard phase", async (): Promise<void> => {
  const bytes = readFileSync(
    new URL(
      "../fixtures/bug-reports/usb-dp-phase-detour/input.json",
      import.meta.url,
    ),
  )
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "78966edc3a39e56ee1253022012c5da28b8dae0a7921d5d3ffde4382c9ebe5af",
  )
  const input = JSON.parse(bytes.toString("utf8")) as SimpleRouteJson
  const originalInput = structuredClone(input)
  expect(input.obstacles).toHaveLength(1112)
  expect(input.connections).toHaveLength(59)
  expect(input.traces).toHaveLength(21)
  expect(input.minTraceWidth).toBe(0.15)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    effort: 1,
    cacheProvider: null,
  })
  // Route the complete unchanged phase input to the width stage, including
  // all pads, nets and existing USB copper. Only the second drawing is cropped.
  while (!solver.traceWidthSolver?.solved && !solver.failed && !solver.solved) {
    solver.step()
    const effects = getPendingEffectsFromSolverTree(solver)
    if (effects.length > 0) {
      await Promise.all(effects.map((effect) => effect.promise))
    }
  }
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.traceWidthSolver?.solved).toBe(true)
  expect(solver.getCurrentPhase()).toBe("globalDrcForceImproveSolver")
  const routedTraces = solver.getNewTracesBeforePowerExpansion()
  const wires = routedTraces.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "wire"),
  )
  expect(routedTraces).toHaveLength(
    solver.netToPointPairsSolver!.newConnections.length,
  )
  expect(wires.length).toBeGreaterThan(0)
  const undersizedWires = wires.filter(
    (point) => point.width < input.minTraceWidth - 1e-9,
  )
  const minimumWidth = Math.min(...wires.map((point) => point.width))
  const terminal = input.connections
    .flatMap((connection) => connection.pointsToConnect)
    .find((point) => point.pcb_port_id === "pcb_port_9")
  if (!terminal) throw new Error("MIDI keyboard capture is missing pcb_port_9")
  const view = {
    center: { x: terminal.x + 1, y: terminal.y },
    width: 6,
    height: 4,
  }
  const stageSrj: SimpleRouteJson = {
    ...input,
    traces: [...solver.getUpdatedPreloadedTraces(), ...routedTraces],
  }
  for (const svgName of ["full-board", "terminal-escape"] as const) {
    const graphics = convertSrjToGraphicsObject(stageSrj)
    graphics.points = []
    if (svgName === "terminal-escape") {
      graphics.rects = graphics.rects.filter((rect) =>
        isPointInRect(rect.center, view),
      )
      graphics.circles = graphics.circles.filter((circle) =>
        isPointInRect(circle.center, view),
      )
      graphics.lines = graphics.lines.flatMap((line) =>
        line.points.slice(0, -1).flatMap((point, index) => {
          const next = line.points[index + 1]!
          if (!isPointInRect(point, view) || !isPointInRect(next, view)) return []
          return [{ ...line, points: [point, next] }]
        }),
      )
    }
    const svg = getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1000,
      svgHeight: 700,
    })
    const color = undersizedWires.length === 0 ? "#166534" : "#b91c1c"
    const summary = `<g data-testid="terminal-taper-summary"><rect x="12" y="12" width="830" height="84" rx="6" fill="white" stroke="${color}"/><text x="24" y="42" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="${color}">Real MIDI keyboard: live trace-width stage</text><text x="24" y="76" font-family="Arial, sans-serif" font-size="18" fill="${color}">Board minimum: ${input.minTraceWidth.toFixed(3)} mm; emitted minimum: ${minimumWidth.toFixed(3)} mm; below minimum: ${undersizedWires.length}</text></g>`
    await expect(svg.replace("</svg>", `${summary}</svg>`)).toMatchSvgSnapshot(
      import.meta.path,
      { svgName, tolerance: 0 },
    )
  }
  expect(undersizedWires).toHaveLength(0)
  expect(input).toEqual(originalInput)
})
