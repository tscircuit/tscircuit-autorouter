import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson } from "lib/types"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy retains a real copper crossing on a mesh edge without generic ports", async (): Promise<void> => {
  const input = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-usb-feed-backbone.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as SimpleRouteJson
  const original = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    effort: 5,
    cacheProvider: null,
  })
  while (!solver.preloadedTraceGraphSolver && !solver.failed) solver.step()
  expect(solver.failed).toBe(false)
  const before = structuredClone(
    solver
      .necessaryCrampedPortPointSolver!.getOutput()
      .find((edge) => edge.edgeId === "ce41286")!,
  )
  expect(before.portPoints).toHaveLength(0)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  expect(input).toEqual(original)
  const after = solver
    .preloadedTraceGraphSolver!.getOutput()
    .find((edge) => edge.edgeId === before.edgeId)!
  expect(after.portPoints).toHaveLength(1)
  const crossing = after.portPoints[0]!
  expect(crossing.x).toBeCloseTo(0.3000248, 8)
  expect(crossing.y).toBeCloseTo(29.026014981628833, 8)
  expect(crossing._preloadedTracePortAssignments).toEqual([
    expect.objectContaining({
      traceId: "source_trace_132_0",
      isFixed: true,
      z: 0,
    }),
  ])
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: original,
    srjWithPointPairs: solver.srjWithPointPairs!,
    includeBoardClearance: true,
    drcOptions: { traceClearance: 0.1, viaClearance: 0.2 },
  })
  expect(evaluate(solver.getOutputSimplifiedPcbTraces()).errors).toEqual([])
  const viewbox = { minX: -0.1, maxX: 1.3, minY: 28.65, maxY: 30.05 }
  for (const [name, edge] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const graphics: GraphicsObject = { lines: [], circles: [], rects: [] }
    for (const trace of original.traces!) {
      if (trace.pcb_trace_id !== "source_trace_132_0") continue
      for (let i = 1; i < trace.route.length; i++) {
        const a = trace.route[i - 1]!
        const b = trace.route[i]!
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== "top" ||
          b.layer !== "top"
        )
          continue
        graphics.lines!.push({
          points: [a, b],
          strokeColor: "#fdba74",
          strokeWidth: a.width,
        })
      }
    }
    const pad = original.obstacles.find((obstacle) =>
      obstacle.connectedTo.includes("pcb_smtpad_17"),
    )!
    graphics.rects!.push({
      center: pad.center,
      width: pad.width,
      height: pad.height,
      stroke: "#334155",
      fill: "transparent",
    })
    graphics.lines!.push({
      points: [edge.start, edge.end],
      strokeColor: "#334155",
      strokeWidth: 0.012,
    })
    if (name === "before")
      graphics.circles!.push({
        center: crossing,
        radius: 0.045,
        stroke: "#dc2626",
        fill: "white",
      })
    for (const port of edge.portPoints)
      graphics.circles!.push({
        center: port,
        radius: 0.045,
        stroke: "#0369a1",
        fill: "#0ea5e9",
      })
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: retained USB power feed at the capacitor pad",
        name === "before"
          ? "Before: the mesh has no port where the existing copper crosses"
          : "After: the exact crossing restores access to the retained feed",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
