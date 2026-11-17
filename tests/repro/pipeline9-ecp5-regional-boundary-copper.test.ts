import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { spliceFixedRouteSection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getEcp5BoundaryCopperPcbSvg } from "tests/fixtures/getEcp5BoundaryCopperPcbSvg"
import { replaceNativePcbTraces } from "tests/fixtures/replaceNativePcbTraces"

type FixedRouteConnectionName = string

type RegionalBoundaryFixture = {
  params: Omit<
    ConstructorParameters<typeof Pipeline9HighDensitySolver>[0],
    "connMap"
  >
  netMap: ConnectivityMap["netMap"]
  srj: SimpleRouteJson
  circuitJson: AnyCircuitElement[]
}

test("captures the ECP5 regional repair losing tangent RAM_A13 copper", async (): Promise<void> => {
  // Captured from the full TSX board's ordinary-signal phase after DDR routing.
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/ecp5-regional-boundary-copper.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as RegionalBoundaryFixture
  const original = structuredClone(fixture)
  const solver = new Pipeline9HighDensitySolver({
    ...fixture.params,
    connMap: new ConnectivityMap(fixture.netMap),
  })

  solver.solve()

  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.error).toBe(
    "Pipeline9 promoted regional fallback could not resolve immutable fixed route conflict(s): source_net_114_fixed_1_0",
  )
  expect(fixture).toEqual(original)

  let fixedRoutes = solver.getUpdatedFixedHdRoutes()
  if (solver.failed) {
    // Show the rejected candidate with omitted copper restored, exactly as
    // the outer conflict check sees it. It is not accepted board routing.
    const candidateRoutes = solver.activeFallbackSolver!.getOutput()
    const replacedNames = new Set<FixedRouteConnectionName>()
    const replacements: PreloadedHighDensityRoute[] = []
    for (const [name, section] of solver.activeFallbackFixedRouteSections) {
      const replacement = candidateRoutes.find(
        (route) => route.connectionName === name,
      )
      if (!replacement) continue
      replacements.push(spliceFixedRouteSection(section, replacement))
      for (const route of section.sourceRoutes) {
        replacedNames.add(route.connectionName)
      }
    }
    fixedRoutes = [
      ...fixedRoutes.filter(
        (route) => !replacedNames.has(route.connectionName),
      ),
      ...replacements,
    ]
  }

  // Native RAM_A13 and RAM_RAS# in the captured Core input.
  const affectedNetIds = new Set(["source_net_114", "source_net_51"])
  const traces = fixedRoutes.flatMap((route): SimplifiedPcbTrace[] => {
    const sourceTrace = fixture.srj.traces![route.preloadedTraceIndex]!
    if (!affectedNetIds.has(sourceTrace.connection_name)) return []
    return [
      {
        type: "pcb_trace",
        pcb_trace_id: route.connectionName,
        connection_name: sourceTrace.connection_name,
        route: convertHdRouteToSimplifiedRoute(route, fixture.srj.layerCount, {
          defaultViaHoleDiameter: fixture.srj.minViaHoleDiameter!,
        }),
      },
    ]
  })
  const circuitJson = replaceNativePcbTraces({
    circuitJson: fixture.circuitJson,
    srj: fixture.srj,
    traces,
  })
  expect(
    circuitJson.filter((element) => element.type === "source_component"),
  ).toHaveLength(163)
  const clearanceOptions = { minClearance: fixture.params.minClearance! }
  const findings = [
    ...checkEachPcbTraceNonOverlapping(circuitJson, clearanceOptions),
    ...checkViaTraceClearance(circuitJson, clearanceOptions),
    ...checkDifferentNetViaSpacing(circuitJson),
  ]
  expect(findings).toHaveLength(3)
  const view = {
    circuitJson,
    node: fixture.params.nodePortPoints[0]!,
    errorCount: findings.length,
  }
  await expect(getEcp5BoundaryCopperPcbSvg(view)).toMatchSvgSnapshot(
    import.meta.path,
    { scale: 1 },
  )
  await expect(
    getEcp5BoundaryCopperPcbSvg({ ...view, focused: true }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "contact", scale: 1 })
})
