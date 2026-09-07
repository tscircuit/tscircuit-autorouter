import {
  checkPadTraceClearance,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { CLEARANCE_PRECISION_MARGIN } from "./applyPipeline9ClearancePrecisionRepairs"
import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

/** Measures the original failing pairs beyond the reference checker's tolerance. */
export const getPipeline9ClearanceMarginErrors = ({
  circuitJson,
  originalCircuitJson,
  targets,
}: {
  circuitJson: AnyCircuitElement[]
  originalCircuitJson: AnyCircuitElement[]
  targets: Pipeline9DrcError[]
}): Pipeline9DrcError[] => {
  const traces = new Map(
    circuitJson
      .filter((element) => element.type === "pcb_trace")
      .map((trace) => [trace.pcb_trace_id, trace]),
  )
  const originalTraces = new Map(
    originalCircuitJson
      .filter((element) => element.type === "pcb_trace")
      .map((trace) => [trace.pcb_trace_id, trace]),
  )
  const vias = circuitJson.filter((element) => element.type === "pcb_via")
  const obstacles = new Map<string, AnyCircuitElement>()
  for (const element of circuitJson) {
    if (element.type === "pcb_via") {
      obstacles.set(element.pcb_via_id, element)
    } else if (element.type === "pcb_smtpad") {
      obstacles.set(element.pcb_smtpad_id, element)
    } else if (element.type === "pcb_plated_hole") {
      obstacles.set(element.pcb_plated_hole_id, element)
    }
  }
  const errors: Pipeline9DrcError[] = []
  for (const target of targets) {
    const isVia = target.type === "pcb_via_trace_clearance_error"
    const obstacleId = isVia ? target.pcb_via_id : target.pcb_pad_id
    if (
      (!isVia && target.type !== "pcb_pad_trace_clearance_error") ||
      typeof target.pcb_trace_id !== "string" ||
      typeof obstacleId !== "string" ||
      typeof target.minimum_clearance !== "number" ||
      !Number.isFinite(target.minimum_clearance) ||
      target.minimum_clearance <= 0
    ) {
      throw new Error("Pipeline9 clearance margin requires a valid target pair")
    }
    const originalTrace = originalTraces.get(target.pcb_trace_id)
    const originalObstacle = originalCircuitJson.find((element) =>
      isVia
        ? element.type === "pcb_via" && element.pcb_via_id === obstacleId
        : (element.type === "pcb_smtpad" &&
            element.pcb_smtpad_id === obstacleId) ||
          (element.type === "pcb_plated_hole" &&
            element.pcb_plated_hole_id === obstacleId),
    )
    if (!originalTrace || !originalObstacle) {
      throw new Error(
        `Pipeline9 clearance margin has no original target ${obstacleId}/${target.pcb_trace_id}`,
      )
    }
    const trace = traces.get(target.pcb_trace_id)
    let obstacle = obstacles.get(obstacleId)
    if (isVia) {
      if (
        originalObstacle.type !== "pcb_via" ||
        typeof originalObstacle.pcb_trace_id !== "string"
      ) {
        throw new Error(
          "Pipeline9 clearance margin requires the original via owner",
        )
      }
      const originalOwner = originalTraces.get(originalObstacle.pcb_trace_id)
      if (!originalOwner) {
        throw new Error(
          "Pipeline9 clearance margin lost the original via owner",
        )
      }
      const originalTransitions = originalOwner.route.filter(
        (segment) => segment.route_type === "via",
      )
      const matchingTransitions = originalTransitions
        .map((segment, index) => ({ segment, index }))
        .filter(
          ({ segment }) =>
            segment.x === originalObstacle.x &&
            segment.y === originalObstacle.y &&
            originalObstacle.layers.includes(segment.from_layer) &&
            originalObstacle.layers.includes(segment.to_layer) &&
            ((segment.from_layer === originalObstacle.layers[0] &&
              segment.to_layer === originalObstacle.layers.at(-1)) ||
              (segment.to_layer === originalObstacle.layers[0] &&
                segment.from_layer === originalObstacle.layers.at(-1))),
        )
        .filter(
          ({ segment }, index, all) =>
            all.findIndex(
              (entry) =>
                entry.segment.from_layer === segment.from_layer &&
                entry.segment.to_layer === segment.to_layer,
            ) === index,
        )
      if (matchingTransitions.length === 0) {
        throw new Error(
          "Pipeline9 clearance margin lost the original via transition",
        )
      }
      // Opposite-direction transitions at one site have separate converter
      // identities. Reject an ambiguous pair rather than infer its owner event.
      if (matchingTransitions.length !== 1) {
        return [{ type: "pipeline9_clearance_margin_identity_error" }]
      }
      const originalTransitionIndex = matchingTransitions[0]!.index
      const owner = traces.get(originalObstacle.pcb_trace_id)
      const transitions = owner?.route.filter(
        (segment) => segment.route_type === "via",
      )
      if (
        !transitions ||
        transitions.length !== originalTransitions.length ||
        transitions.some(
          (segment, index) =>
            segment.from_layer !== originalTransitions[index]!.from_layer ||
            segment.to_layer !== originalTransitions[index]!.to_layer,
        )
      ) {
        return [{ type: "pipeline9_clearance_margin_identity_error" }]
      }
      const transition = transitions[originalTransitionIndex]!
      // Global via_N ids can shift when a shared-site move deduplicates vias.
      // The owner's transition ordinal survives coordinate and wire edits.
      // Coincident opposite-direction events may retain different diameters;
      // measure the largest copper envelope at the selected physical site.
      obstacle = vias
        .filter(
          (via) =>
            via.x === transition.x &&
            via.y === transition.y &&
            via.layers.join() === originalObstacle.layers.join(),
        )
        .reduce<(typeof vias)[number] | undefined>(
          (largest, via) =>
            !largest || via.outer_diameter > largest.outer_diameter
              ? via
              : largest,
          undefined,
        )
    }
    if (!trace || !obstacle || !("x" in obstacle) || !("y" in obstacle)) {
      return [{ type: "pipeline9_clearance_margin_identity_error" }]
    }
    // Each pair already failed reference DRC on different nets. Measure only
    // those two objects; unrelated nearby copper keeps its original rules.
    // A wider reporting radius exposes actual_clearance even when the normal
    // checker accepts the pair using its floating-point tolerance.
    const options = { minClearance: target.minimum_clearance + 1 }
    const measuredErrors = isVia
      ? checkViaTraceClearance([trace, obstacle], options)
      : checkPadTraceClearance([trace, obstacle], options)
    const minimumClearance =
      target.minimum_clearance + CLEARANCE_PRECISION_MARGIN
    for (const measured of measuredErrors) {
      const actualClearance = measured.actual_clearance
      if (
        typeof actualClearance !== "number" ||
        !Number.isFinite(actualClearance)
      ) {
        throw new Error(
          "Pipeline9 clearance margin requires a finite measurement",
        )
      }
      if (actualClearance >= minimumClearance) continue
      errors.push({
        ...target,
        ...(obstacle.type === "pcb_via"
          ? {
              pcb_via_id: obstacle.pcb_via_id,
              pcb_via_ids: [obstacle.pcb_via_id],
            }
          : {}),
        actual_clearance: actualClearance,
        minimum_clearance: minimumClearance,
        center: { x: obstacle.x, y: obstacle.y },
      })
    }
  }
  // The typed clearance checks omit actual overlaps. The caller must still
  // require complete reference DRC, including overlap and continuity checks.
  return errors
}
