import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
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
  "Pipeline9 reproduces the exact unrouted T113-S3 supervisor PCB",
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
    await expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
      import.meta.path,
      { tolerance: 0 },
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

    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
    expect(solver.error).toContain(
      "B01 failed: No path found for source_net_2_mst0",
    )
    expect(solver.error).toContain(
      "regional force-improve output failed its candidate validator",
    )
    const failedConnection = solver.srjWithPointPairs?.connections.find(
      (connection) => connection.name === "source_net_2_mst0",
    )
    expect(
      failedConnection?.pointsToConnect.map((point) => point.pcb_port_id),
    ).toEqual(["pcb_port_19", "pcb_port_25"])
  },
  { timeout: 60_000 },
)
