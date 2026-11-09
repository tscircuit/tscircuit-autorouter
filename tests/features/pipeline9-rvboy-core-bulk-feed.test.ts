import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy core feed can branch from fixed copper while keeping foreign-net clearance", async (): Promise<void> => {
  // Exact complete native phase 38 input. Only the snapshot viewport is cropped.
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL("../fixtures/rvboy-core-bulk-feed.json.gz", import.meta.url),
        ),
      ),
    ).toString(),
  )
  const original = JSON.stringify(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    effort: 5,
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(1)
  expect(traces[0]!.connectsTo).toEqual(["pcb_port_462", "pcb_port_400"])
  expect(
    traces[0]!.route.every(
      (point) =>
        point.route_type === "wire" &&
        point.layer === "top" &&
        point.width === 0.6,
    ),
  ).toBe(true)
  const route = traces[0]!.route.filter((point) => point.route_type === "wire")
  expect(
    route
      .slice(1)
      .reduce(
        (length, point, index) =>
          length +
          Math.hypot(point.x - route[index]!.x, point.y - route[index]!.y),
        0,
      ),
  ).toBeLessThan(40)
  const drc = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    includeBoardClearance: true,
    // RVboy manufacturing clearance, stronger than benchmark relaxed rules.
    drcOptions: { traceClearance: 0.1, viaClearance: 0.2 },
  })(traces)
  expect(drc.errors).toEqual([])
  const graph = (
    solver.portPointPathingSolver as unknown as {
      tinyPipelineSolver: {
        inputProblem: { serializedHyperGraph: SerializedHyperGraph }
      }
    }
  ).tinyPipelineSolver.inputProblem.serializedHyperGraph
  const connection = graph.connections!.find(
    (connection) => connection.connectionId === "source_trace_387",
  )!
  const southExit = graph.ports.find(
    (port) => port.portId === "ce44437_pp0_z0::0",
  )!
  expect(southExit.d!.clearanceAllowedNetIds).toEqual([
    connection.mutuallyConnectedNetworkId,
  ])
  // A retained 0.1 mm branch remains represented, but cannot carry a new 0.6 mm route.
  const narrowCrossing = graph.ports.find(
    (port) => port.portId === "ce45610_retained0_z0::0",
  )!
  expect(narrowCrossing.d!._preloadedTracePortAssignments).toHaveLength(1)
  expect(narrowCrossing.d!.clearanceAllowedNetIds).toEqual([])
  expect(JSON.stringify(input)).toBe(original)
  for (const [name, routed] of [
    ["before", []],
    ["after", traces],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...input,
      traces: [...input.traces!, ...routed],
    })
    graphics.points = []
    await expect(
      renderRvboyRoutingView(
        graphics,
        { minX: -5, maxX: 0.7, minY: 0.8, maxY: 5.2 },
        "RVboy core supply: exact native phase input",
        name === "before"
          ? "Before: fixed same-net copper removes the bulk-capacitor escape"
          : `After: 0.6 mm native feed; ${drc.errors.length} clearance errors; ground vias retained`,
      ).replace(/[ \t]+$/gm, ""),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
