// Pinned from @tscircuit/checks 0.0.233 bundled source; see the authoritative-drc-fork LICENSE and PROVENANCE.md.
import { getBoundsOfPcbElements } from "@tscircuit/circuit-json-util"
import type {
  AnyCircuitElement,
  PcbHole,
  PCBKeepout,
  PcbPlatedHole,
  PcbSmtPad,
  PcbTrace,
  PcbTraceError,
  PcbVia,
} from "circuit-json"
import {
  getPillCenterLineForPad,
  getPolygonPointsForPad,
} from "./segment-to-polygon-clearance"

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type PcbTraceSegment = {
  type: "pcb_trace_segment"
  _pcbTrace: PcbTrace
  pcb_trace_id: string
  thickness: number
  layer: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export type Collidable =
  | PcbTraceSegment
  | PcbSmtPad
  | PcbPlatedHole
  | PcbHole
  | PcbVia
  | PCBKeepout

export const getCollidableBounds = (collidable: Collidable): Bounds => {
  if (
    (collidable.type === "pcb_hole" &&
      (collidable.hole_shape === "pill" ||
        collidable.hole_shape === "rotated_pill")) ||
    (collidable.type === "pcb_smtpad" && collidable.shape === "rotated_pill")
  ) {
    const pill = getPillCenterLineForPad(collidable)
    return {
      minX: Math.min(pill.start.x, pill.end.x) - pill.radius,
      minY: Math.min(pill.start.y, pill.end.y) - pill.radius,
      maxX: Math.max(pill.start.x, pill.end.x) + pill.radius,
      maxY: Math.max(pill.start.y, pill.end.y) + pill.radius,
    }
  }
  if (collidable.type === "pcb_trace_segment") {
    return {
      minX: Math.min(collidable.x1, collidable.x2),
      minY: Math.min(collidable.y1, collidable.y2),
      maxX: Math.max(collidable.x1, collidable.x2),
      maxY: Math.max(collidable.y1, collidable.y2),
    }
  }

  if (
    collidable.type === "pcb_smtpad" ||
    collidable.type === "pcb_plated_hole"
  ) {
    const isPolygon =
      (collidable.type === "pcb_smtpad" &&
        (collidable.shape === "rotated_rect" ||
          collidable.shape === "polygon")) ||
      (collidable.type === "pcb_plated_hole" &&
        "rect_pad_width" in collidable &&
        "rect_pad_height" in collidable)

    if (isPolygon) {
      const polygonPoints = getPolygonPointsForPad(collidable)
      return {
        minX: Math.min(...polygonPoints.map((point) => point.x)),
        minY: Math.min(...polygonPoints.map((point) => point.y)),
        maxX: Math.max(...polygonPoints.map((point) => point.x)),
        maxY: Math.max(...polygonPoints.map((point) => point.y)),
      }
    }
  }

  return getBoundsOfPcbElements([collidable as any])
}
