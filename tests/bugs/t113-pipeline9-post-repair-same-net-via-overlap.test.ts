import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { CircuitJson, PcbVia } from "circuit-json"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { stackSvgsHorizontally, stackSvgsVertically } from "stack-svgs"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/"
const newTraceId = "source_net_19_mst1_0"
const preloadedTraceId =
  "source_trace_52__source_trace_54__source_trace_56__breakout:pcb_breakout_point_21_mst3_0"
const issueCenter = { x: -2.234, y: -12.096 }

type ViaOverlapFixture = {
  minimumClearance: number
  actualClearance: number
  newVia: PcbVia
  preloadedVia: PcbVia
}

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

const createLabel = (title: string, subtitle: string): string => `<svg
  xmlns="http://www.w3.org/2000/svg"
  width="700"
  height="70"
  viewBox="0 0 700 70"
>
  <rect width="700" height="70" fill="#f4f4f4" />
  <text x="350" y="26" fill="#111" font-family="Arial, sans-serif"
    font-size="18" font-weight="700" text-anchor="middle">${title}</text>
  <text x="350" y="51" fill="#4b5563" font-family="Arial, sans-serif"
    font-size="14" text-anchor="middle">${subtitle}</text>
</svg>`

const createViaPanel = ({
  title,
  subtitle,
  newVia,
  preloadedVia,
  minimumClearance,
}: {
  title: string
  subtitle: string
  newVia: PcbVia
  preloadedVia: PcbVia
  minimumClearance: number
}): string => {
  const minimumCenterDistance =
    newVia.hole_diameter / 2 + preloadedVia.hole_diameter / 2 + minimumClearance
  const graphic = getSvgFromGraphicsObject(
    {
      circles: [
        {
          center: newVia,
          radius: minimumCenterDistance,
          fill: "#2563eb14",
          stroke: "#2563eb",
          label: "required via clearance",
        },
        {
          center: newVia,
          radius: newVia.outer_diameter / 2,
          fill: "#2563eb",
          label: newVia.pcb_trace_id,
        },
        {
          center: preloadedVia,
          radius: preloadedVia.outer_diameter / 2,
          fill: "#dc2626cc",
          stroke: "#991b1b",
          label: preloadedVia.pcb_trace_id,
        },
        {
          center: newVia,
          radius: newVia.hole_diameter / 2,
          fill: "white",
          stroke: "#1e3a8a",
          label: "new via drill",
        },
        {
          center: preloadedVia,
          radius: preloadedVia.hole_diameter / 2,
          fill: "white",
          stroke: "#7f1d1d",
          label: "preloaded via drill",
        },
      ],
      rects: [
        {
          center: issueCenter,
          width: 1.6,
          height: 1.6,
          fill: "#00000000",
          stroke: "#00000000",
        },
      ],
    },
    { backgroundColor: "white", svgWidth: 700, svgHeight: 600 },
  )
  return stackSvgsVertically([createLabel(title, subtitle), graphic], {
    gap: 0,
    normalizeSize: false,
  })
}

test("merges same-net vias introduced by T113 joint repair", async () => {
  const srj = readCompressedFixture<SimpleRouteJson>(
    "t113-linux-exact.srj.json.gz",
  )
  const circuitJson = readCompressedFixture<CircuitJson>(
    "t113-linux-exact-unrouted.circuit.json.gz",
  )
  const overlapBefore = JSON.parse(
    readFileSync(
      new URL(
        `${fixtureDirectory}t113-post-repair-via-overlap.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as ViaOverlapFixture
  expect(
    circuitJson.filter((element) => element.type === "source_component"),
  ).toHaveLength(96)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getNewTracesBeforePowerExpansion()).toHaveLength(42)

  const routedCopper = convertToCircuitJson(
    solver.srjWithPointPairs!,
    solver.getOutputSimpleRouteJson().traces ?? [],
    {
      minTraceWidth: srj.minTraceWidth,
      minViaDiameter: srj.minViaDiameter,
      originalSrj: srj,
      includeOriginalConnections: true,
    },
  ) as CircuitJson
  const routedCircuitJson = [...circuitJson, ...routedCopper] as CircuitJson
  expect(getDrcErrors(structuredClone(routedCircuitJson)).errors).toEqual([])

  const vias = routedCopper.filter(
    (element): element is PcbVia => element.type === "pcb_via",
  )
  const newVia = vias.find(
    (via) =>
      via.pcb_trace_id === newTraceId &&
      Math.hypot(via.x - issueCenter.x, via.y - issueCenter.y) < 0.5,
  )
  if (!newVia) throw new Error("Missing the exact T113 routed via")
  const preloadedVia = vias
    .filter((via) => via.pcb_trace_id === preloadedTraceId)
    .sort(
      (left, right) =>
        Math.hypot(left.x - newVia.x, left.y - newVia.y) -
        Math.hypot(right.x - newVia.x, right.y - newVia.y),
    )[0]
  if (!preloadedVia) throw new Error("Missing the exact T113 preloaded vias")

  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  expect(connMap.areIdsConnected("source_net_19", "source_trace_52")).toBe(true)
  const centerDistance = Math.hypot(
    newVia.x - preloadedVia.x,
    newVia.y - preloadedVia.y,
  )
  const minimumCenterDistance =
    newVia.hole_diameter / 2 +
    preloadedVia.hole_diameter / 2 +
    overlapBefore.minimumClearance
  expect(centerDistance).toBeGreaterThanOrEqual(minimumCenterDistance)

  const beforeCenterDistance = Math.hypot(
    overlapBefore.newVia.x - overlapBefore.preloadedVia.x,
    overlapBefore.newVia.y - overlapBefore.preloadedVia.y,
  )
  expect(
    beforeCenterDistance -
      overlapBefore.newVia.hole_diameter / 2 -
      overlapBefore.preloadedVia.hole_diameter / 2,
  ).toBeCloseTo(overlapBefore.actualClearance)

  const comparisonSvg = stackSvgsHorizontally(
    [
      createViaPanel({
        title: "BEFORE · REPAIR CREATES OVERLAPPING VIAS",
        subtitle: "The two drill holes overlap despite sharing a net",
        newVia: overlapBefore.newVia,
        preloadedVia: overlapBefore.preloadedVia,
        minimumClearance: overlapBefore.minimumClearance,
      }),
      createViaPanel({
        title: "AFTER · SAME-NET VIAS MERGED AGAIN",
        subtitle: "The redundant overlap is removed after joint repair",
        newVia,
        preloadedVia,
        minimumClearance: overlapBefore.minimumClearance,
      }),
    ],
    { gap: 16, normalizeSize: false },
  )
  await expect(comparisonSvg.replace(/[ \t]+$/gm, "")).toMatchSvgSnapshot(
    import.meta.path,
    {
      svgName: "post-repair-via-merge",
      tolerance: 0.02,
    },
  )
})
