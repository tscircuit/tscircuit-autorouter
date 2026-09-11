import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-supervisor-boundary-clearance/"
const readCompressedFixture = (filename: string): string =>
  gunzipSync(
    Uint8Array.from(
      readFileSync(new URL(`${fixtureDirectory}${filename}`, import.meta.url)),
    ),
  ).toString("utf8")
const circuitJson = JSON.parse(
  readCompressedFixture(
    "t113-linux-supervisor-boundary-clearance.circuit.json.gz",
  ),
) as CircuitJson
const srj = JSON.parse(
  readCompressedFixture("t113-linux-supervisor-boundary-clearance.srj.json.gz"),
) as SimpleRouteJson

test(
  "Pipeline9 routes the exact T113-S3 supervisor PCB",
  async () => {
    expect(
      circuitJson.filter((element) => element.type === "source_component"),
    ).toHaveLength(41)
    expect(
      circuitJson.filter((element) => element.type === "pcb_component"),
    ).toHaveLength(41)
    expect(
      circuitJson.filter((element) => element.type === "pcb_port"),
    ).toHaveLength(222)
    expect(
      circuitJson.filter(
        (element) => element.type === "pcb_trace" || element.type === "pcb_via",
      ),
    ).toEqual([])
    const autoroutingErrors = circuitJson.filter(
      (element) => element.type === "pcb_autorouting_error",
    )
    expect(autoroutingErrors).toHaveLength(1)
    expect(autoroutingErrors[0]!.message).toContain(
      "B01 failed: No path found for source_net_2_mst0",
    )
    expect(srj.obstacles).toHaveLength(222)
    expect(srj.traces).toHaveLength(40)
    expect(
      srj.connections.map((connection) => connection.pointsToConnect.length),
    ).toEqual([2, 7, 20, 43])

    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(srj),
      { cacheProvider: null },
    )
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.error).toBeNull()
    const pllToRtcConnection = solver.srjWithPointPairs?.connections.find(
      (connection) => connection.name === "source_net_2_mst0",
    )
    expect(
      pllToRtcConnection?.pointsToConnect.map((point) => point.pcb_port_id),
    ).toEqual(["pcb_port_19", "pcb_port_25"])
    const pllToRtcTrace = solver
      .getNewTracesBeforePowerExpansion()
      .find((trace) => trace.pcb_trace_id === "source_net_2_mst0_0")
    expect(pllToRtcTrace?.connectsTo).toEqual(["pcb_port_19", "pcb_port_25"])
    expect(pllToRtcTrace?.route.length).toBeGreaterThan(2)

    const outputTraces = solver.getOutputSimpleRouteJson().traces!
    expect(outputTraces).toHaveLength(94)
    const routedCopper = convertToCircuitJson(srj, outputTraces).filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    )
    expect(
      routedCopper.filter((element) => element.type === "pcb_trace"),
    ).toHaveLength(94)
    const routedVias = routedCopper.filter(
      (element) => element.type === "pcb_via",
    )
    expect(routedVias).toHaveLength(47)
    await expect(
      convertCircuitJsonToPcbSvg([...circuitJson, ...routedCopper]),
    ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
  },
  { timeout: 60_000 },
)
