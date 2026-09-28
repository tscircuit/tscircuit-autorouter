import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { ReactElement } from "react"

// Public methods used from pinned core 0.0.1861. The paired module re-exports
// the actual implementations; this declaration changes no runtime behavior.
// Keeping this surface small avoids loading incompatible generated core/JSX
// declaration graphs alongside the repository's existing core version.
type FixtureCircuitJson = Array<{ type: string }>
type FixtureInitialTrace = Omit<SimplifiedPcbTrace, "connection_name"> & {
  connection_name?: string
}
type FixtureSimpleRouteJson = Omit<SimpleRouteJson, "traces"> & {
  traces?: FixtureInitialTrace[]
}
type FixtureRouteConversionOptions = {
  circuitJson: FixtureCircuitJson
  minTraceWidth?: number
  nominalTraceWidth?: number
  minViaHoleDiameter?: number
  minViaPadDiameter?: number
  minViaEdgeToPadEdgeClearance?: number
  minTraceToPadEdgeClearance?: number
  ignoreExistingTopLevelPcbRouteState?: boolean
  fanoutPourNetMap?: Record<string, string>
}

export declare class RootCircuit {
  constructor()
  schematicDisabled: boolean
  add(element: ReactElement): void
  renderUntilSettled(): Promise<void>
  // Native records retain their complete runtime schema and contents.
  // Consumers establish the narrower view their renderer understands.
  getCircuitJson(): FixtureCircuitJson
}

export declare function getSimpleRouteJsonFromCircuitJson(
  options: FixtureRouteConversionOptions,
): { simpleRouteJson: FixtureSimpleRouteJson }
