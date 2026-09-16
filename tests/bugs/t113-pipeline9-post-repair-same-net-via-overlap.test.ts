import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { CircuitJson, PcbVia } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { stackSvgsHorizontally } from "stack-svgs"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/"
const newTraceId = "source_net_19_mst1_0"
const preloadedTraceId =
  "source_trace_52__source_trace_54__source_trace_56__breakout:pcb_breakout_point_21_mst3_0"
const issueCenter = { x: -2.234, y: -12.096 }

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

test("captures same-net vias separated again after T113 joint repair", async () => {
  const circuitJson = readCompressedFixture<CircuitJson>(
    "t113-linux-exact-unrouted.circuit.json.gz",
  )
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

  const outputTraces = solver.getOutputSimpleRouteJson().traces ?? []
  const routedCircuitJson = convertToCircuitJson(
    solver.srjWithPointPairs!,
    outputTraces,
    {
      minTraceWidth: srj.minTraceWidth,
      minViaDiameter: srj.minViaDiameter,
      originalSrj: srj,
      includeOriginalConnections: true,
    },
  ) as CircuitJson
  const vias = routedCircuitJson.filter(
    (element): element is PcbVia => element.type === "pcb_via",
  )
  const findViaNearIssue = (pcbTraceId: string) =>
    vias.find(
      (via) =>
        via.pcb_trace_id === pcbTraceId &&
        Math.hypot(via.x - issueCenter.x, via.y - issueCenter.y) < 0.5,
    )
  const newVia = findViaNearIssue(newTraceId)
  const preloadedVia = findViaNearIssue(preloadedTraceId)
  if (!newVia || !preloadedVia) {
    throw new Error("Missing the exact T113 post-repair via pair")
  }

  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  expect(connMap.areIdsConnected("source_net_19", "source_trace_52")).toBe(
    true,
  )
  const centerDistance = Math.hypot(
    newVia.x - preloadedVia.x,
    newVia.y - preloadedVia.y,
  )
  const minimumCenterDistance =
    newVia.outer_diameter / 2 + preloadedVia.outer_diameter / 2 + 0.1
  expect(centerDistance).toBeLessThan(minimumCenterDistance)

  const focusSvg = getSvgFromGraphicsObject(
    {
      circles: [
        {
          center: newVia,
          radius: minimumCenterDistance,
          fill: "#3388ff12",
          stroke: "#3388ff",
          label: "required via clearance",
        },
        {
          center: newVia,
          radius: newVia.outer_diameter / 2,
          fill: "#3388ff",
          label: newTraceId,
        },
        {
          center: preloadedVia,
          radius: preloadedVia.outer_diameter / 2,
          fill: "#ff334488",
          stroke: "#ff3344",
          label: preloadedTraceId,
        },
      ],
      rects: [
        {
          center: issueCenter,
          width: 1.6,
          height: 1.6,
          fill: "#00000000",
        },
      ],
    },
    { backgroundColor: "white", svgWidth: 700, svgHeight: 700 },
  )
  const routedCopper = routedCircuitJson.filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  await expect(
    stackSvgsHorizontally(
      [
        convertCircuitJsonToPcbSvg([...circuitJson, ...routedCopper]),
        focusSvg,
      ],
      { gap: 12, normalizeSize: false },
    ).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "real-pcb-and-post-repair-vias",
    tolerance: 0.02,
  })
}, 600_000)
