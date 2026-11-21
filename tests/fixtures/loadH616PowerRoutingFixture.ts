import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { FixedRouteSection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

type RegionalSolverParams = ConstructorParameters<
  typeof Pipeline9RegionalFallbackSolver
>[0]

type H616PowerRoutingFixture = {
  inputSrj: SimpleRouteJson
  circuitJson: AnyCircuitElement[]
  focusCenter: { x: number; y: number }
  regionalRoutes: HighDensityRoute[]
  regionalProblem: {
    params: Omit<
      RegionalSolverParams,
      "connMap" | "movablePreloadedConnectionNames"
    > & { movablePreloadedConnectionNames: string[] }
    netMap: Record<string, string[]>
    fixedRouteSections: Record<string, FixedRouteSection>
  }
}

export function loadH616PowerRoutingFixture(): H616PowerRoutingFixture {
  return JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/h616-power-routing-full-board.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as H616PowerRoutingFixture
}
