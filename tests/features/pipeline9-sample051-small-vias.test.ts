import { expect, test } from "bun:test"
import { checkViaPadClearance } from "@tscircuit/checks"
import { sample051 } from "@tscircuit/dataset-srj33-drc-failures"
import type { AnyCircuitElement } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { safeTransparentize } from "lib/solvers/colors"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

type PcbViaWithTraceId = AnyCircuitElement & {
  type: "pcb_via"
  pcb_via_id: string
  pcb_trace_id: string
}

test("Pipeline9 routes sample051 with smaller vias and centered terminals", async (): Promise<void> => {
  // This is a different board configuration from the unchanged two-error
  // repro: 0.25 mm via pads, 0.10 mm drills, and explicit via-in-pad permission.
  const original = structuredClone(sample051) as unknown as SimpleRouteJson
  const input: SimpleRouteJson = {
    ...original,
    minViaDiameter: 0.25,
    minViaPadDiameter: 0.25,
    min_via_pad_diameter: 0.25,
    minViaHoleDiameter: 0.1,
    min_via_hole_diameter: 0.1,
    allowViaInPad: true,
    // Width scheduling reads per-connection nominal widths. Request 0.15 mm
    // explicitly so no narrower intermediate route passes through unchanged.
    connections: original.connections.map((connection) => ({
      ...connection,
      nominalTraceWidth: original.minTraceWidth,
    })),
  }
  const beforeSolve = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(input).toEqual(beforeSolve)
  const result = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    includeBoardClearance: true,
  }
  expect(result.routedTraces).toHaveLength(
    result.srjWithPointPairs.connections.length,
  )
  expect(result.routedTraces.length).toBeGreaterThan(0)
  const { circuitJson, errors } = evaluateRelaxedDrc(result)
  expect(errors).toEqual([])

  // Via-to-pad clearance is an additional check beyond the relaxed preset.
  const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
  connMap.addConnections(
    circuitJson
      .filter(
        (element): element is PcbViaWithTraceId =>
          element.type === "pcb_via" &&
          typeof element.pcb_trace_id === "string",
      )
      .map((via) => [via.pcb_via_id, via.pcb_trace_id]),
  )
  expect(
    checkViaPadClearance(circuitJson, {
      connMap,
      minClearance: input.minPadEdgeToPadEdgeClearance,
    }),
  ).toEqual([])

  const originalPoints = new Map(
    original.connections.flatMap((connection) =>
      connection.pointsToConnect.map((point) => [point.pcb_port_id, point]),
    ),
  )
  for (const trace of result.routedTraces) {
    expect(trace.connectsTo).toHaveLength(2)
    for (const portId of trace.connectsTo!) {
      const point = originalPoints.get(portId)!
      expect(point).toBeDefined()
      expect([trace.route[0], trace.route.at(-1)]).toContainEqual(
        expect.objectContaining({
          route_type: "wire",
          x: point.x,
          y: point.y,
          layer: point.layer,
        }),
      )
    }
    for (const point of trace.route) {
      if (point.route_type === "wire") {
        expect(point.width).toBe(original.minTraceWidth)
      } else if (point.route_type === "via") {
        expect(point.via_diameter).toBe(input.minViaPadDiameter)
        expect(point.via_hole_diameter).toBe(input.minViaHoleDiameter)
      }
    }
  }
  const terminal = originalPoints.get("pcb_port_48")!
  const traceA = result.routedTraces.find(
    (trace) => trace.pcb_trace_id === "source_net_25_0",
  )!
  // The formerly colliding trace now changes layers at the original pad
  // center instead of moving its endpoint toward the pad's edge.
  expect(traceA.route).toContainEqual(
    expect.objectContaining({
      route_type: "via",
      x: terminal.x,
      y: terminal.y,
      via_diameter: 0.25,
      via_hole_diameter: 0.1,
    }),
  )

  await expect(
    getBugReportSnapshotSvg(result, { roundTraceCaps: true }).replace(
      /[ \t]+$/gm,
      "",
    ),
  ).toMatchSvgSnapshot(import.meta.path)

  // Show the same PCB region and trace pair as the original repro.
  const detail = convertSrjToGraphicsObject(
    {
      ...input,
      bounds: { minX: 8.3, maxX: 10.7, minY: 1.5, maxY: 4.5 },
      obstacles: input.obstacles.filter(
        (obstacle) => obstacle.componentId === "pcb_component_12",
      ),
      traces: result.routedTraces
        .filter((trace) =>
          ["source_net_25_0", "source_net_2_mst1_0"].includes(
            trace.pcb_trace_id,
          ),
        )
        .map((trace) => ({
          ...trace,
          route: trace.route.filter(
            (point) =>
              "x" in point &&
              point.x >= 8.3 &&
              point.x <= 10.7 &&
              point.y >= 1.5 &&
              point.y <= 4.5,
          ),
        })),
    },
    { traceColorMode: "net" },
  )
  detail.points = []
  // Reserve the crop's full extent so the DRC badge does not cover copper.
  detail.rects.push({
    center: { x: 9.5, y: 3 },
    width: 2.4,
    height: 3,
    fill: "transparent",
    stroke: "none",
  })
  for (const line of detail.lines) {
    line.strokeColor = safeTransparentize(line.strokeColor!, 0)
  }
  for (const circle of detail.circles) {
    circle.fill = safeTransparentize(circle.fill!, 0)
  }
  await expect(
    getBugReportSnapshotSvg(result, {
      graphics: detail,
      includeTextLabels: false,
      roundTraceCaps: true,
    }).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "terminal-detail" })
})
