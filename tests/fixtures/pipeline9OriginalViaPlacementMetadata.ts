import type { AnyCircuitElement } from "circuit-json"
import { getPipeline9OriginalViaPlacementDrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalViaPlacementDrcErrors"
import { evaluateJointOriginalViaPlacement, makeJointOriginalViaPlacementFixture } from "./pipeline9JointOriginalViaPlacement"

type ViaElement = Extract<AnyCircuitElement, { type: "pcb_via" }>
type MetadataFixtureOverrides = {
  viaId?: string
  traceId?: string
  x?: number
  y?: number
  diameter?: number
  layers?: ViaElement["layers"]
}

export const makeOriginalViaPlacementMetadataFixture = (
  kind: "board" | "foreign-pad",
  overrides: MetadataFixtureOverrides = {},
): { circuitJson: AnyCircuitElement[]; errors: Array<Record<string, unknown>>; viaId: string; traceId: string; padId: string } => {
  const fixture = makeJointOriginalViaPlacementFixture(kind)
  const circuitJson = structuredClone(evaluateJointOriginalViaPlacement(fixture, fixture.params.newHdRoutes).reference.circuitJson)
  const via = circuitJson.find((element) => element.type === "pcb_via")
  if (!via || via.type !== "pcb_via") throw new Error("Metadata fixture requires a manufactured via")
  const traceId = overrides.traceId ?? "trace_with_via_like_tokens_18"
  for (const element of circuitJson) {
    if (element.type === "pcb_trace" && element.pcb_trace_id === via.pcb_trace_id) element.pcb_trace_id = traceId
  }
  via.pcb_via_id = overrides.viaId ?? "barrel_with_many_under_scores_27"
  via.pcb_trace_id = traceId
  via.x = overrides.x ?? via.x
  via.y = overrides.y ?? via.y
  via.outer_diameter = overrides.diameter ?? via.outer_diameter
  via.layers = overrides.layers ? [...overrides.layers] : via.layers
  const errors = getPipeline9OriginalViaPlacementDrcErrors({ circuitJson, minViaEdgeToPadEdgeClearance: 0.1 })
  return { circuitJson, errors, viaId: via.pcb_via_id, traceId, padId: "original_pad_with_under_scores" }
}
