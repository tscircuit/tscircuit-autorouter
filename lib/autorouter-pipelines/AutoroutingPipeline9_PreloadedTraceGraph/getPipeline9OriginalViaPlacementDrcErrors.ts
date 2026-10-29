import { checkViaPadClearance, checkViasOffBoard } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"

type DrcError = Record<string, unknown>
type ViaElement = Extract<AnyCircuitElement, { type: "pcb_via" }>
type PadIdentity = { type: "pcb_smtpad" | "pcb_plated_hole"; id: string }

export type Pipeline9OriginalViaPlacementGeometry = {
  kind: "board" | "pad"
  pcbTraceId: string
  x: number
  y: number
  outerDiameter: number
  layers: string[]
  pad?: PadIdentity
}

/** Keep the original checker findings, including its typed ownership waivers. */
export const getPipeline9OriginalViaPlacementDrcErrors = ({
  circuitJson,
  minViaEdgeToPadEdgeClearance,
}: {
  circuitJson: AnyCircuitElement[]
  minViaEdgeToPadEdgeClearance: number
}): DrcError[] => {
  const clearance = minViaEdgeToPadEdgeClearance
  if (!Number.isFinite(clearance) || clearance < 0) {
    throw new Error("Original via-placement DRC requires a valid pad clearance")
  }
  if (circuitJson.filter((element) => element.type === "pcb_board").length !== 1) {
    throw new Error("Original via-placement DRC requires exactly one physical board")
  }
  return [...checkViasOffBoard(circuitJson),
    ...checkViaPadClearance(circuitJson, { minClearance: clearance })] as unknown as DrcError[]
}

export const getPipeline9OriginalViaPlacementErrorKind = (
  error: DrcError,
): "board" | "pad" | undefined => {
  const types = [error.type, error.error_type].filter((value) => value !== undefined)
  const placementId = error.pcb_placement_error_id
  if (types.length === 0) return undefined
  if (types.every((value) => value === "pcb_placement_error") &&
    typeof placementId === "string" &&
    ["out_of_board_", "copper_too_close_to_board_edge_"]
      .some((prefix) => placementId.startsWith(prefix))) return "board"
  if (types.every((value) => value === "pcb_pad_pad_clearance_error") &&
    typeof error.pcb_pad_pad_clearance_error_id === "string" &&
    error.pcb_pad_pad_clearance_error_id.startsWith("via_pad_clearance_")) return "pad"
  return undefined
}

/** Attribute only exact, unique typed via/trace/pad identities in this CJSON. */
export const addPipeline9OriginalViaPlacementMetadata = ({
  errors,
  circuitJson,
}: {
  errors: DrcError[]
  circuitJson: AnyCircuitElement[]
}): DrcError[] => {
  const viasById = new Map<string, ViaElement | null>()
  const traceCounts = new Map<string, number>()
  const padsById = new Map<string, PadIdentity | null>()
  const identityCounts = new Map<string, number>()
  for (const element of circuitJson) {
    if (element.type === "pcb_via") {
      identityCounts.set(element.pcb_via_id, (identityCounts.get(element.pcb_via_id) ?? 0) + 1)
      viasById.set(element.pcb_via_id,
        viasById.has(element.pcb_via_id) ? null : element)
    } else if (element.type === "pcb_trace") {
      identityCounts.set(element.pcb_trace_id, (identityCounts.get(element.pcb_trace_id) ?? 0) + 1)
      traceCounts.set(element.pcb_trace_id, (traceCounts.get(element.pcb_trace_id) ?? 0) + 1)
    } else if (element.type === "pcb_smtpad" || element.type === "pcb_plated_hole") {
      const id = element.type === "pcb_smtpad" ? element.pcb_smtpad_id : element.pcb_plated_hole_id
      identityCounts.set(id, (identityCounts.get(id) ?? 0) + 1)
      padsById.set(id, padsById.has(id) ? null : { type: element.type, id })
    }
  }
  return errors.map((error) => {
    const kind = getPipeline9OriginalViaPlacementErrorKind(error)
    if (!kind || error.pcb_via_id !== undefined || error.pcb_via_ids !== undefined ||
      error.viaPlacementGeometry !== undefined) return error
    let viaId: string | undefined
    let pad: PadIdentity | undefined
    if (kind === "board") {
      const id = error.pcb_placement_error_id as string
      const prefix = ["out_of_board_", "copper_too_close_to_board_edge_"]
        .find((candidate) => id.startsWith(candidate))!
      viaId = id.slice(prefix.length)
    } else {
      if (!Array.isArray(error.pcb_pad_ids) || error.pcb_pad_ids.length !== 2 ||
        !error.pcb_pad_ids.every((id) => typeof id === "string")) return error
      const candidates = error.pcb_pad_ids.filter((id) => viasById.get(id))
      if (candidates.length !== 1) return error
      viaId = candidates[0]
      const padId = error.pcb_pad_ids.find((id) => id !== viaId)
      if (typeof padId !== "string") return error
      pad = padsById.get(padId) ?? undefined
      if (!pad || identityCounts.get(pad.id) !== 1) return error
    }
    const via = viasById.get(viaId)
    if (!via || identityCounts.get(viaId) !== 1 || typeof via.pcb_trace_id !== "string" ||
      traceCounts.get(via.pcb_trace_id) !== 1 || identityCounts.get(via.pcb_trace_id) !== 1 ||
      ![via.x, via.y, via.outer_diameter].every(Number.isFinite) || via.outer_diameter <= 0 ||
      !Array.isArray(via.layers) || via.layers.length === 0 ||
      !via.layers.every((layer) => typeof layer === "string")) return error
    const geometry: Pipeline9OriginalViaPlacementGeometry = { kind,
      pcbTraceId: via.pcb_trace_id, x: via.x, y: via.y,
      outerDiameter: via.outer_diameter, layers: [...via.layers].sort(),
      ...(pad ? { pad } : {}),
    }
    return { ...error, pcb_via_id: viaId, pcb_via_ids: [viaId],
      ...(error.center === undefined ? { center: { x: via.x, y: via.y } } : {}),
      viaPlacementGeometry: geometry,
    }
  })
}
