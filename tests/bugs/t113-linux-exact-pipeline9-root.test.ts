import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { isPipeline9ObstacleConnectedToRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
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

test("recognizes the exact T113 same-net pad during regional validation", () => {
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

  const t113PowerPad = srj.obstacles.find(
    (obstacle) =>
      obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_139",
  )
  expect(t113PowerPad).toBeDefined()
  expect(t113PowerPad!.connectedTo).toContain("source_trace_44")
  expect(
    isPipeline9ObstacleConnectedToRoute({
      obstacle: t113PowerPad!,
      route: {
        connectionName: "source_trace_44_fixed_262_13",
        rootConnectionName: canonicalNetId,
      },
      connMap: solver.connMap,
    }),
  ).toBe(true)

  const capturedPcbSvg = readFileSync(
    new URL(
      `${fixtureDirectory}t113-linux-exact-pipeline9-state.svg`,
      import.meta.url,
    ),
    "utf8",
  )
  expect(capturedPcbSvg).toStartWith("<svg")
})
