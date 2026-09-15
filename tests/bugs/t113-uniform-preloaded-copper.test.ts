import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { stackSvgsHorizontally } from "stack-svgs"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-uniform-preloaded-copper/"
const affectedConnectionName = "source_net_3_mst12"

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

test("routes the real T113 supervisor net around fixed preloaded copper", async () => {
  const circuitJson = readCompressedFixture<CircuitJson>(
    "t113-uniform-preloaded-copper.circuit.json.gz",
  )
  const srj = readCompressedFixture<SimpleRouteJson>(
    "t113-uniform-preloaded-copper.srj.json.gz",
  )

  expect(
    circuitJson.filter((element) => element.type === "source_component"),
  ).toHaveLength(41)
  expect(
    circuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(41)
  expect(
    circuitJson.filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    ),
  ).toEqual([])

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()

  expect(solver.portPointPathingSolver?.solved).toBe(true)
  expect(solver.error).not.toContain(
    `No path found for ${affectedConnectionName}`,
  )
  const affectedRoutes = (solver.highDensityRouteSolver?.routes ?? []).filter(
    (route) => route.connectionName === affectedConnectionName,
  )
  expect(affectedRoutes.length).toBeGreaterThan(0)
  const affectedTraces: SimplifiedPcbTrace[] = affectedRoutes.map(
    (route, routeIndex) => ({
      type: "pcb_trace",
      pcb_trace_id: `t113_supervisor_${routeIndex}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, srj.layerCount),
    }),
  )
  const fixedCopper = convertToCircuitJson(srj, srj.traces ?? []).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  const affectedCopper = convertToCircuitJson(srj, affectedTraces).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  const targetTraceIds = new Set(
    affectedCopper.flatMap((element) =>
      element.type === "pcb_trace" ? [element.pcb_trace_id] : [],
    ),
  )
  const targetErrors = getDrcErrors([...fixedCopper, ...affectedCopper], {
    traceClearance: srj.minTraceToPadEdgeClearance,
    includeTraceContinuity: false,
  }).errors.filter((error) =>
    [error.pcb_trace_id, ...(error.pcb_trace_ids ?? [])].some((traceId) =>
      targetTraceIds.has(traceId),
    ),
  )
  expect(targetErrors).toEqual([])

  await expect(
    stackSvgsHorizontally(
      [
        convertCircuitJsonToPcbSvg([...circuitJson, ...fixedCopper]),
        convertCircuitJsonToPcbSvg([
          ...circuitJson,
          ...fixedCopper,
          ...affectedCopper,
        ]),
      ],
      { gap: 12, normalizeSize: false },
    ).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "real-pcb-and-uniform-stage",
    tolerance: 0.02,
  })
})
