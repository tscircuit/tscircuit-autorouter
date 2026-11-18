import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyFixedRouteReplacementsToPreloadedTraces"
import {
  convertPreloadedTraceToHdRoutes,
  type PreloadedHighDensityRoute,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { spliceFixedRouteSection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { loadH616PowerRoutingFixture } from "./loadH616PowerRoutingFixture"
import { replaceNativePcbTraces } from "./replaceNativePcbTraces"

type H616Fixture = ReturnType<typeof loadH616PowerRoutingFixture>

/** Splice the regional signal repair into its original full native PCB. */
export function applyH616RegionalRoutes({
  fixture,
  routes,
}: {
  fixture: H616Fixture
  routes: HighDensityRoute[]
}): AnyCircuitElement[] {
  const { inputSrj, regionalProblem } = fixture
  const connMap = new ConnectivityMap(regionalProblem.netMap)
  const originalTraces = inputSrj.traces!
  const originalFixedRoutes = originalTraces.flatMap(
    (trace, traceIndex): PreloadedHighDensityRoute[] =>
      convertPreloadedTraceToHdRoutes(
        trace,
        traceIndex,
        inputSrj.layerCount,
        regionalProblem.params.viaDiameter,
        connMap,
      ),
  )
  const replacedConnectionNames = new Set<string>()
  const replacements = Object.entries(
    regionalProblem.fixedRouteSections,
  ).map(([connectionName, section]): PreloadedHighDensityRoute => {
    const replacement = routes.find(
      (route): boolean => route.connectionName === connectionName,
    )
    if (!replacement) {
      throw new Error(`Missing regional replacement for ${connectionName}`)
    }
    for (const route of section.sourceRoutes) {
      replacedConnectionNames.add(route.connectionName)
    }
    return spliceFixedRouteSection(section, replacement)
  })
  const { updatedPreloadedTraces } =
    applyFixedRouteReplacementsToPreloadedTraces({
      originalTraces,
      originalFixedRoutes,
      updatedFixedRoutes: [
        ...originalFixedRoutes.filter(
          (route): boolean => !replacedConnectionNames.has(route.connectionName),
        ),
        ...replacements,
      ],
      replacedConnectionNames,
      layerCount: inputSrj.layerCount,
      defaultViaHoleDiameter: inputSrj.minViaHoleDiameter!,
      obstacles: inputSrj.obstacles,
      connMap,
    })
  return replaceNativePcbTraces({
    circuitJson: fixture.circuitJson,
    srj: inputSrj,
    traces: updatedPreloadedTraces,
  })
}
