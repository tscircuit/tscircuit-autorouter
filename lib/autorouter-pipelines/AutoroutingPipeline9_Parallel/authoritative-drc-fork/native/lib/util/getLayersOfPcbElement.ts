// Pinned from @tscircuit/checks 0.0.233 bundled source; see the authoritative-drc-fork LICENSE and PROVENANCE.md.
import type { Collidable } from "../check-each-pcb-trace-non-overlapping/getCollidableBounds"
import { all_layers } from "circuit-json"

export function getLayersOfPcbElement(obj: Collidable): string[] {
  if (obj.type === "pcb_trace_segment") {
    return [obj.layer]
  }
  if (obj.type === "pcb_smtpad") {
    return [obj.layer]
  }
  if (obj.type === "pcb_plated_hole") {
    return Array.isArray(obj.layers) ? obj.layers : [...all_layers]
  }
  if (obj.type === "pcb_hole") {
    return [...all_layers]
  }
  if (obj.type === "pcb_via") {
    return Array.isArray(obj.layers) ? obj.layers : [...all_layers]
  }
  if (obj.type === "pcb_keepout") {
    return Array.isArray(obj.layers) ? obj.layers : []
  }
  return []
}
