import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { stackSvgsHorizontally } from "stack-svgs"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-fanout-terminal-coordinate/"
const readCompressedFixture = <T>(filename: string): T =>
  JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(new URL(`${fixtureDirectory}${filename}`, import.meta.url)),
      ),
    ).toString("utf8"),
  ) as T

const unroutedCircuitJson = readCompressedFixture<CircuitJson>(
  "t113-linux-fanout-terminal-coordinate-unrouted.circuit.json.gz",
)
const beforeCircuitJson = readCompressedFixture<CircuitJson>(
  "t113-linux-fanout-terminal-coordinate-before.circuit.json.gz",
)
const afterCircuitJson = readCompressedFixture<CircuitJson>(
  "t113-linux-fanout-terminal-coordinate-after.circuit.json.gz",
)
const srj = readCompressedFixture<SimpleRouteJson>(
  "t113-linux-fanout-terminal-coordinate.srj.json.gz",
)

const getCount = (circuitJson: CircuitJson, type: string) =>
  circuitJson.filter((element) => element.type === type).length
const getErrorCount = (circuitJson: CircuitJson) =>
  circuitJson.filter((element) => element.type.endsWith("_error")).length
const getWireEndpointCoordinates = (
  route: NonNullable<SimpleRouteJson["traces"]>[number]["route"],
) => {
  const wires = route.filter((point) => point.route_type === "wire")
  return [wires[0], wires.at(-1)]
    .map((point) => ({ x: point!.x, y: point!.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y)
}

test("Pipeline9 preserves the exact fanout terminals on the 66-component T113-S3 PCB", async () => {
  for (const circuitJson of [
    unroutedCircuitJson,
    beforeCircuitJson,
    afterCircuitJson,
  ]) {
    expect(getCount(circuitJson, "source_component")).toBe(66)
    expect(getCount(circuitJson, "pcb_component")).toBe(66)
  }
  expect(getCount(unroutedCircuitJson, "pcb_trace")).toBe(0)
  expect(getCount(unroutedCircuitJson, "pcb_via")).toBe(0)
  expect(getErrorCount(beforeCircuitJson)).toBe(15)
  expect(getErrorCount(afterCircuitJson)).toBe(0)
  expect(srj.obstacles).toHaveLength(299)
  expect(srj.connections).toHaveLength(12)
  expect(srj.traces).toHaveLength(83)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()

  const outputTraces = solver.getOutputSimplifiedPcbTraces()
  for (const [sourceTraceId, sourceNetId] of [
    ["source_trace_179", "source_net_0"],
    ["source_trace_180", "source_net_1"],
    ["source_trace_181", "source_net_3"],
  ] as const) {
    const inputConnection = srj.connections.find(
      (connection) => connection.name === sourceTraceId,
    )!
    const outputTrace = outputTraces.find(
      (trace) =>
        trace.pcb_trace_id.startsWith(`${sourceTraceId}__${sourceNetId}_mst0_`) &&
        trace.connectsTo?.every((id) => id.startsWith("pcb_breakout_point_")),
    )!
    expect(outputTrace).toBeDefined()
    expect(getWireEndpointCoordinates(outputTrace.route)).toEqual(
      inputConnection.pointsToConnect
        .map((point) => ({ x: point.x, y: point.y }))
        .sort((a, b) => a.x - b.x || a.y - b.y),
    )
    expect(outputTrace.source_trace_id).toBe(sourceNetId)
  }

  const fixedTraces = (
    solver.powerTraceExpansionSolver!
      .inputSrj as Pipeline7PowerTraceExpansionInput
  ).fixedTraces
  expect(
    evaluateRelaxedDrc({
      inputSrj: { ...srj, traces: fixedTraces },
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.postPowerTraceViaMergeSolver!.getOutput(),
    }).errors,
  ).toEqual([])

  await expect(
    stackSvgsHorizontally(
      [
        convertCircuitJsonToPcbSvg(unroutedCircuitJson),
        convertCircuitJsonToPcbSvg(afterCircuitJson),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "unrouted-routed",
    tolerance: 0,
  })
}, 60_000)
