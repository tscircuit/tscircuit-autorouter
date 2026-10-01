import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { expect, test } from "bun:test"
import type { CircuitJson, PcbVia } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { stackSvgsHorizontally } from "stack-svgs"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-hdmi-ddc-via-spacing/"
const expectedSrjSha256 =
  "dc19c3abc1788919eea83e1fd7318d072776c3445ddb3208ff5885f66f64b11b"
const expectedCircuitJsonSha256 =
  "b83ca178c2556cbe3950c4c6fe730c8953417a49fc2702415ad31b6684376ecb"

const readCompressedFixture = <T>(
  filename: string,
  expectedSha256: string,
): T => {
  const bytes = gunzipSync(
    Uint8Array.from(
      readFileSync(new URL(`${fixtureDirectory}${filename}`, import.meta.url)),
    ),
  )
  const fixtureText = bytes.toString("utf8")
  expect(createHash("sha256").update(fixtureText).digest("hex")).toBe(
    expectedSha256,
  )
  return JSON.parse(fixtureText) as T
}

test("repairs T113 HDMI 1.8 V same-net drill spacing", async (): Promise<void> => {
  const input = readCompressedFixture<SimpleRouteJson>(
    "t113-linux-hdmi-ddc-via-spacing.srj.json.gz",
    expectedSrjSha256,
  )
  const circuitJson = readCompressedFixture<CircuitJson>(
    "t113-linux-hdmi-ddc-via-spacing-unrouted.circuit.json.gz",
    expectedCircuitJsonSha256,
  )

  expect(input.connections).toHaveLength(258)
  expect(input.obstacles).toHaveLength(605)
  expect(input.traces).toHaveLength(0)
  expect(input.layerCount).toBe(4)
  expect(input.minViaHoleEdgeToViaHoleEdgeClearance).toBe(0.2)
  expect(
    circuitJson.filter((element) => element.type === "source_component"),
  ).toHaveLength(141)
  expect(
    circuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(141)
  expect(
    circuitJson.filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    ),
  ).toEqual([])

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
    { cacheProvider: null, effort: 2 },
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces).toHaveLength(388)

  const viaClearance = input.minViaHoleEdgeToViaHoleEdgeClearance!
  const drc = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    drcOptions: { viaClearance },
  })
  const viaErrors = drc.errors.filter(
    (error) => error.type === "pcb_via_clearance_error",
  )
  expect(viaErrors).toHaveLength(0)

  const vias = drc.circuitJson.filter(
    (element): element is PcbVia => element.type === "pcb_via",
  )
  const mst10Vias = vias.filter((via) =>
    via.pcb_trace_id?.includes("source_net_4_mst10_0"),
  )
  const mst15Vias = vias.filter((via) =>
    via.pcb_trace_id?.includes("source_net_4_mst15_0"),
  )
  const closestPair = mst10Vias
    .flatMap((viaA) => mst15Vias.map((viaB) => [viaA, viaB] as const))
    .sort(
      ([viaA, viaB], [nextViaA, nextViaB]) =>
        Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y) -
        Math.hypot(nextViaA.x - nextViaB.x, nextViaA.y - nextViaB.y),
    )[0]
  if (!closestPair) {
    throw new Error("Missing the repaired T113 HDMI 1.8 V via pair")
  }
  const [viaA, viaB] = closestPair
  const centerDistance = Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y)
  const minimumSeparateCenterDistance =
    viaA.hole_diameter / 2 + viaB.hole_diameter / 2 + viaClearance
  const usesSharedDrill = centerDistance < 1e-9
  expect(
    usesSharedDrill || centerDistance >= minimumSeparateCenterDistance,
  ).toBe(true)

  const routedCircuitJson = convertToCircuitJson(
    solver.srjWithPointPairs!,
    routedTraces,
    {
      minTraceWidth: input.minTraceWidth,
      minViaDiameter: input.minViaDiameter,
      originalSrj: input,
      includeOriginalConnections: true,
    },
  ) as CircuitJson
  const routedCopper = routedCircuitJson.filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  const focusSvg = getSvgFromGraphicsObject(
    {
      circles: [
        {
          center: viaA,
          radius: viaA.hole_diameter / 2 + viaClearance,
          fill: "#16a34a12",
          stroke: "#16a34a",
          label: usesSharedDrill
            ? "0.20 mm clearance from shared drill edge"
            : "0.20 mm clearance from first drill edge",
        },
        {
          center: viaA,
          radius: viaA.hole_diameter / 2,
          fill: "#16a34a",
          label: usesSharedDrill ? "shared HDMI 1.8 V drill" : "first drill",
        },
        ...(!usesSharedDrill
          ? [
              {
                center: viaB,
                radius: viaB.hole_diameter / 2 + viaClearance,
                fill: "#2563eb12",
                stroke: "#2563eb",
                label: "0.20 mm clearance from second drill edge",
              },
              {
                center: viaB,
                radius: viaB.hole_diameter / 2,
                fill: "#2563eb",
                label: "second drill",
              },
            ]
          : []),
      ],
      rects: [
        {
          center: {
            x: (viaA.x + viaB.x) / 2,
            y: (viaA.y + viaB.y) / 2,
          },
          width: Math.max(1.2, Math.abs(viaA.x - viaB.x) + 1),
          height: Math.max(1.2, Math.abs(viaA.y - viaB.y) + 1),
          fill: "#00000000",
        },
      ],
    },
    { backgroundColor: "white", svgWidth: 700, svgHeight: 700 },
  )
  await expect(
    stackSvgsHorizontally(
      [convertCircuitJsonToPcbSvg([...circuitJson, ...routedCopper]), focusSvg],
      { gap: 12, normalizeSize: false },
    ).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "board-and-drills",
    tolerance: 0.02,
  })
})
