// Pinned from @tscircuit/checks 0.0.233 bundled source; see the authoritative-drc-fork LICENSE and PROVENANCE.md.
import type { PcbBoard } from "circuit-json"

export type JlcToleranceMap = Partial<Record<keyof PcbBoard, number>>

export const jlcMinTolerances: JlcToleranceMap = {
  min_trace_width: 0.1,
  min_via_hole_edge_to_via_hole_edge_clearance: 0.1,
  min_plated_hole_drill_edge_to_drill_edge_clearance: 0.15,
  min_trace_to_hole_edge_clearance: 0.2,
  min_trace_to_pad_edge_clearance: 0.1,
  min_pad_edge_to_pad_edge_clearance: 0.1,
  min_board_edge_clearance: 0.2,
  min_via_hole_diameter: 0.2,
  min_via_pad_diameter: 0.3,
}

// TODO: Update these values
export const jlcPreferredTolerances: JlcToleranceMap = {
  min_trace_width: 0.2,
  min_via_hole_edge_to_via_hole_edge_clearance: 0.2,
  min_plated_hole_drill_edge_to_drill_edge_clearance: 0.2,
  min_trace_to_hole_edge_clearance: 0.2,
  min_trace_to_pad_edge_clearance: 0.2,
  min_pad_edge_to_pad_edge_clearance: 0.2,
  min_board_edge_clearance: 0.2,
  min_via_hole_diameter: 0.4,
  min_via_pad_diameter: 0.6,
}
