import {
  distanceBetweenCircleAndCircle,
  distanceBetweenCircleAndPolygon,
  getBoundsOfPcbElements,
} from "@tscircuit/circuit-json-util"
import { segmentToCircleMinDistance } from "@tscircuit/math-utils"
import type { AnyCircuitElement } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { formatMm } from "format-si-unit"
import RBush from "rbush"
import {
  compileTraceClearanceObstacle,
  getTraceObstacleClearance,
} from "./createTraceObstacleClearanceEvaluator"
import { getDrcReadableElementName } from "./drcReadableNames"

type Pad = Extract<
  AnyCircuitElement,
  { type: "pcb_smtpad" | "pcb_plated_hole" }
>
type IndexedPad = ReturnType<typeof compileTraceClearanceObstacle>
type ViaPadClearanceEvaluator = (
  circuitJson: AnyCircuitElement[],
  connMap: ConnectivityMap,
) => Record<string, unknown>[]

/** Reuses original pad geometry while checking candidate via copper clearance. */
export const createViaPadClearanceEvaluator = (
  staticCircuitJson: AnyCircuitElement[],
  options: { minClearance?: number } = {},
): ViaPadClearanceEvaluator => {
  const board = staticCircuitJson.find(
    (element) => element.type === "pcb_board",
  )
  const clearance =
    options.minClearance ?? board?.min_pad_edge_to_pad_edge_clearance ?? 0.1
  const pads = staticCircuitJson
    .filter(
      (element): element is Pad =>
        element.type === "pcb_smtpad" || element.type === "pcb_plated_hole",
    )
    .sort(
      (left, right) =>
        Number(left.type === "pcb_plated_hole") -
        Number(right.type === "pcb_plated_hole"),
    )
  const index = new RBush<IndexedPad>()
  index.load(
    pads.map((pad, order) => {
      const compiled = compileTraceClearanceObstacle(pad, order)
      // Preserve the reference grid's pad bounds, including rotated-pad eligibility.
      return { ...compiled, ...compiled.clearanceBounds }
    }),
  )
  return (circuitJson, connMap): Record<string, unknown>[] => {
    const errors: Record<string, unknown>[] = []
    for (const via of circuitJson) {
      if (via.type !== "pcb_via") continue
      const viaBounds = getBoundsOfPcbElements([via])
      const minBucketX = Math.floor((viaBounds.minX - clearance) / 0.4)
      const minBucketY = Math.floor((viaBounds.minY - clearance) / 0.4)
      const maxBucketX = Math.floor((viaBounds.maxX + clearance) / 0.4)
      const maxBucketY = Math.floor((viaBounds.maxY + clearance) / 0.4)
      const candidates = index
        .search({
          minX: minBucketX * 0.4,
          minY: minBucketY * 0.4,
          maxX: (maxBucketX + 1) * 0.4,
          maxY: (maxBucketY + 1) * 0.4,
        })
        .filter(
          (pad) =>
            Math.floor(pad.minX / 0.4) <= maxBucketX &&
            Math.floor(pad.maxX / 0.4) >= minBucketX &&
            Math.floor(pad.minY / 0.4) <= maxBucketY &&
            Math.floor(pad.maxY / 0.4) >= minBucketY,
        )
        .sort(
          (left, right) =>
            Math.max(minBucketX, Math.floor(left.minX / 0.4)) -
              Math.max(minBucketX, Math.floor(right.minX / 0.4)) ||
            Math.max(minBucketY, Math.floor(left.minY / 0.4)) -
              Math.max(minBucketY, Math.floor(right.minY / 0.4)) ||
            left.order - right.order,
        )
      for (const pad of candidates) {
        if (!via.layers.some((layer) => pad.layers.includes(layer))) continue
        if (connMap.areIdsConnected(via.pcb_via_id, pad.id)) continue
        const circle = {
          kind: "circle" as const,
          x: (viaBounds.minX + viaBounds.maxX) / 2,
          y: (viaBounds.minY + viaBounds.maxY) / 2,
          radius:
            Math.min(
              viaBounds.maxX - viaBounds.minX,
              viaBounds.maxY - viaBounds.minY,
            ) / 2,
        }
        const gap =
          pad.shape.kind === "circle"
            ? distanceBetweenCircleAndCircle(circle, {
                kind: "circle",
                x: (pad.clearanceBounds.minX + pad.clearanceBounds.maxX) / 2,
                y: (pad.clearanceBounds.minY + pad.clearanceBounds.maxY) / 2,
                radius:
                  Math.min(
                    pad.clearanceBounds.maxX - pad.clearanceBounds.minX,
                    pad.clearanceBounds.maxY - pad.clearanceBounds.minY,
                  ) / 2,
              })
            : pad.shape.kind === "capsule"
              ? segmentToCircleMinDistance(
                  pad.shape.start,
                  pad.shape.end,
                  circle,
                ) - pad.shape.radius
              : distanceBetweenCircleAndPolygon(circle, {
                  kind: "polygon",
                  points: pad.shape.points,
                }) - (pad.shape.radius ?? 0)
        if (gap + 0.005 >= clearance) continue
        errors.push({
          type: "pcb_pad_pad_clearance_error",
          error_type: "pcb_pad_pad_clearance_error",
          pcb_pad_pad_clearance_error_id: `via_pad_clearance_${via.pcb_via_id}_${pad.id}`,
          message: `Via ${getDrcReadableElementName(circuitJson, via.pcb_via_id)} and pad ${getDrcReadableElementName(circuitJson, pad.id)} are too close (clearance: ${formatMm(gap)}, minimum: ${formatMm(clearance)})`,
          pcb_pad_ids: [via.pcb_via_id, pad.id],
          minimum_clearance: clearance,
          actual_clearance: gap,
          center: getTraceObstacleClearance(via, via, via.outer_diameter, pad)
            .center,
          pcb_via_ids: [via.pcb_via_id],
          ...(typeof via.pcb_trace_id === "string"
            ? { pcb_trace_id: via.pcb_trace_id }
            : {}),
        })
      }
    }
    return errors
  }
}
