import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { stackSvgsHorizontally } from "stack-svgs"

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

test("advances the exact T113-S3 PCB past canonical net ownership", async () => {
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
  ).toBe(true)

  while (
    solver.getCurrentPhase() !== "traceSimplificationSolver" &&
    !solver.solved &&
    !solver.failed
  ) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  expect(solver.highDensityRouteSolver?.solved).toBe(true)
  expect(solver.getCurrentPhase()).toBe("traceSimplificationSolver")

  const newlyRoutedTraces = solver.getNewTracesBeforePowerExpansion()
  expect(newlyRoutedTraces).toHaveLength(42)
  expect(() => solver.step()).toThrow(
    'Pipeline9 could not reconnect mutated preloaded segment "breakout:pcb_breakout_point_68_fixed_168_1"',
  )

  const preloadedFanoutCopper = convertToCircuitJson(
    srj,
    srj.traces ?? [],
  ).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  expect(
    preloadedFanoutCopper.filter((element) => element.type === "pcb_trace"),
  ).toHaveLength(342)
  expect(
    preloadedFanoutCopper.filter((element) => element.type === "pcb_via")
      .length,
  ).toBeGreaterThan(0)
  const newlyRoutedCopper = convertToCircuitJson(srj, newlyRoutedTraces).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  expect(
    newlyRoutedCopper.filter((element) => element.type === "pcb_trace"),
  ).toHaveLength(42)
  await expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "pcb", tolerance: 0.02 },
  )
  await expect(
    stackSvgsHorizontally(
      [
        convertCircuitJsonToPcbSvg([...circuitJson, ...preloadedFanoutCopper]),
        convertCircuitJsonToPcbSvg([
          ...circuitJson,
          ...preloadedFanoutCopper,
          ...newlyRoutedCopper,
        ]),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "unrouted-preloaded-fanout",
    tolerance: 0.02,
  })
}, 120_000)
