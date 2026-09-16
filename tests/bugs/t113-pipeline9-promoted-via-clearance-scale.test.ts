import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { CircuitJson, PcbTrace, PcbVia } from "circuit-json"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/"
const viaOwnerTraceId =
  "source_trace_52__source_trace_54__source_trace_56__breakout:pcb_breakout_point_21_mst3_0"
const foreignTraceId =
  "source_trace_57__source_trace_59__source_trace_61__source_trace_71__source_trace_73__source_trace_75__source_trace_79__breakout:pcb_breakout_point_0__breakout:pcb_breakout_point_1__breakout:pcb_breakout_point_2__breakout:pcb_breakout_point_15__breakout:pcb_breakout_point_16__breakout:pcb_breakout_point_22__breakout:pcb_breakout_point_34__breakout:pcb_breakout_point_41__breakout-net:pcb_group_0:source_net_16_mst17_0"
const issueCenter = { x: -2.21, y: -11.59 }

const readCompressedFixture = <T>(filename: string): T =>
  JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(`${fixtureDirectory}${filename}`, import.meta.url),
        ),
      ),
    ).toString("utf8"),
  ) as T

test("keeps the T113 promoted via clear of the foreign trace", async () => {
  const srj = readCompressedFixture<SimpleRouteJson>(
    "t113-linux-exact.srj.json.gz",
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getNewTracesBeforePowerExpansion()).toHaveLength(42)

  const routedCircuitJson = convertToCircuitJson(
    solver.srjWithPointPairs!,
    solver.getOutputSimpleRouteJson().traces ?? [],
    {
      minTraceWidth: srj.minTraceWidth,
      minViaDiameter: srj.minViaDiameter,
      originalSrj: srj,
      includeOriginalConnections: true,
    },
  ) as CircuitJson
  const via = routedCircuitJson
    .filter(
      (element): element is PcbVia =>
        element.type === "pcb_via" && element.pcb_trace_id === viaOwnerTraceId,
    )
    .sort(
      (left, right) =>
        Math.hypot(left.x - issueCenter.x, left.y - issueCenter.y) -
        Math.hypot(right.x - issueCenter.x, right.y - issueCenter.y),
    )[0]
  if (!via) throw new Error("Missing the exact T113 promoted via")
  const foreignTrace = routedCircuitJson.find(
    (element): element is PcbTrace =>
      element.type === "pcb_trace" && element.pcb_trace_id === foreignTraceId,
  )
  if (!foreignTrace) throw new Error("Missing the exact T113 foreign trace")

  const targetErrors = getDrcErrors(routedCircuitJson, {
    includeTraceContinuity: false,
  }).errors.filter(
    (error) =>
      error.type === "pcb_via_trace_clearance_error" &&
      error.pcb_via_id === via.pcb_via_id &&
      error.pcb_trace_id === foreignTraceId,
  )
  expect(targetErrors).toEqual([])

  const nearbyForeignWires = foreignTrace.route.filter(
    (routePoint) =>
      routePoint.route_type === "wire" &&
      routePoint.layer === "top" &&
      Math.hypot(routePoint.x - issueCenter.x, routePoint.y - issueCenter.y) <
        0.85,
  )
  const requiredCenterDistance =
    via.outer_diameter / 2 + srj.minTraceWidth / 2 + 0.1
  const focusSvg = getSvgFromGraphicsObject(
    {
      lines: [
        {
          points: nearbyForeignWires,
          strokeColor: "#ff3344",
          strokeWidth: srj.minTraceWidth,
        },
      ],
      circles: [
        {
          center: via,
          radius: requiredCenterDistance,
          fill: "#3388ff12",
          stroke: "#3388ff",
          label: "required via-to-trace clearance",
        },
        {
          center: via,
          radius: via.outer_diameter / 2,
          fill: "#3388ff",
          label: viaOwnerTraceId,
        },
      ],
      rects: [
        {
          center: issueCenter,
          width: 1.5,
          height: 1.5,
          fill: "#00000000",
        },
      ],
    },
    {
      backgroundColor: "white",
      svgWidth: 800,
      svgHeight: 800,
    },
  )
  await expect(focusSvg).toMatchSvgSnapshot(import.meta.path, {
    svgName: "promoted-via-and-foreign-trace",
    tolerance: 0.02,
  })
}, 600_000)
