import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/"

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

test("reproduces the exact T113-S3 Pipeline9 root failure", () => {
  const circuitJson = readCompressedFixture<CircuitJson>(
    "t113-linux-exact-unrouted.circuit.json.gz",
  )
  const srj = readCompressedFixture<SimpleRouteJson>(
    "t113-linux-exact.srj.json.gz",
  )

  expect(
    circuitJson.filter((element) => element.type === "source_component"),
  ).toHaveLength(96)
  expect(
    circuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(96)
  expect(
    circuitJson.filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    ),
  ).toEqual([])
  expect(srj.connections).toHaveLength(29)
  expect(srj.obstacles).toHaveLength(397)
  expect(srj.traces).toHaveLength(342)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  const canonicalNetId = solver.connMap.getNetConnectedToId("source_trace_44")

  expect(canonicalNetId).toBe("connectivity_net57")
  expect(
    solver.connMap.areIdsConnected(canonicalNetId!, "source_trace_44"),
  ).toBe(false)

  const capturedPcbSvg = readFileSync(
    new URL(
      `${fixtureDirectory}t113-linux-exact-pipeline9-state.svg`,
      import.meta.url,
    ),
    "utf8",
  )
  expect(capturedPcbSvg).toStartWith("<svg")
})
