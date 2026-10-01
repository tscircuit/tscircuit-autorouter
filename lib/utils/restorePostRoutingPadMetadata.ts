import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson } from "../types"
import type { PostRoutingPhysicalInput } from "../solvers/DynamicNetTreeSolver/createDynamicNetTreeProblem"

/** Attach drill/plating facts lost by an SRJ producer, using the producer's
 * authoritative Circuit JSON. Exact pad and port IDs plus unchanged land
 * geometry/layers are required. Never infer plating from a layer count.
 * Slotted drills remain explicitly unsupported rather than becoming circles.
 */
export function restorePostRoutingPadMetadata(
  srj: SimpleRouteJson,
  circuitJson: readonly AnyCircuitElement[],
): PostRoutingPhysicalInput {
  const output = structuredClone(srj) as PostRoutingPhysicalInput
  const pads = new Map<string, AnyCircuitElement>()
  for (const element of circuitJson) {
    const id =
      element.type === "pcb_plated_hole"
        ? element.pcb_plated_hole_id
        : element.type === "pcb_smtpad"
          ? element.pcb_smtpad_id
          : undefined
    if (!id) continue
    if (pads.has(id)) throw new Error(`Duplicate authoritative pad ID ${id}`)
    pads.set(id, element)
  }
  const close = (a: number, b: number) =>
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6
  for (const obstacle of output.obstacles) {
    const metadata = obstacle.circuitJsonMetadata
    const id = metadata?.pcb_plated_hole_id ?? metadata?.pcb_smtpad_id
    if (!id) continue
    const source = pads.get(id)
    if (!source) continue // Missing evidence stays missing; validation rejects it.
    if (source.type !== "pcb_plated_hole" && source.type !== "pcb_smtpad")
      throw new Error(`Invalid pad source ${id}`)
    if (metadata?.pcb_port_id && source.pcb_port_id !== metadata.pcb_port_id)
      throw new Error(`Authoritative pad port mismatch ${id}`)
    const plated = source.type === "pcb_plated_hole"
    if (Boolean(metadata?.pcb_plated_hole_id) !== plated)
      throw new Error(`Authoritative pad type mismatch ${id}`)
    const land = source as unknown as {
      x: number
      y: number
      layers?: string[]
      layer?: string
      width?: number
      height?: number
      radius?: number
      outer_width?: number
      outer_height?: number
      outer_diameter?: number
      rect_pad_width?: number
      rect_pad_height?: number
      rect_ccw_rotation?: number
      ccw_rotation?: number
      shape: string
      hole_diameter?: number
      hole_width?: number
      hole_height?: number
      hole_offset_x?: number
      hole_offset_y?: number
      rect_pad_border_radius?: number
      border_radius?: number
    }
    const supported = plated
      ? ["circle", "pill", "oval", "circular_hole_with_rect_pad"]
      : ["circle", "rect"]
    if (!supported.includes(land.shape)) {
      obstacle.unsupportedPhysicalGeometry = `source land shape ${land.shape}`
      continue
    }
    if (
      (land.hole_offset_x ?? 0) !== 0 ||
      (land.hole_offset_y ?? 0) !== 0 ||
      (land.rect_pad_border_radius ?? land.border_radius ?? 0) !== 0
    ) {
      obstacle.unsupportedPhysicalGeometry = "offset drill or rounded land"
      continue
    }
    const expectedType =
      land.shape === "circle"
        ? "circle"
        : land.shape === "circular_hole_with_rect_pad" || land.shape === "rect"
          ? "rect"
          : "oval"
    // SRJ's canonical oval with equal axes is exactly a circular land.
    const circleAsOval =
      land.shape === "circle" &&
      (obstacle.type as string) === "oval" &&
      close(obstacle.width, obstacle.height)
    if (obstacle.type !== expectedType && !circleAsOval)
      throw new Error(`Authoritative pad shape mismatch ${id}`)
    const width = plated
      ? (land.outer_width ?? land.outer_diameter ?? land.rect_pad_width)
      : (land.width ??
        (land.radius === undefined ? undefined : 2 * land.radius))
    const height = plated
      ? (land.outer_height ?? land.outer_diameter ?? land.rect_pad_height)
      : (land.height ??
        (land.radius === undefined ? undefined : 2 * land.radius))
    const layers = land.layers ?? (land.layer ? [land.layer] : [])
    const active = obstacle.layers.filter(
      (layer) => srj.layerCount !== 2 || layer === "top" || layer === "bottom",
    )
    const rotationGap = Math.abs(
      (((obstacle.ccwRotationDegrees ?? 0) -
        (land.ccw_rotation ?? land.rect_ccw_rotation ?? 0) +
        540) %
        360) -
        180,
    )
    const rotationEquivalent =
      land.shape === "circle" ||
      (width !== undefined &&
        height !== undefined &&
        close(width, height) &&
        rotationGap % 90 < 1e-6)
    if (
      !close(obstacle.center.x, land.x) ||
      !close(obstacle.center.y, land.y) ||
      width === undefined ||
      height === undefined ||
      !close(obstacle.width, width) ||
      !close(obstacle.height, height) ||
      (!rotationEquivalent && rotationGap > 1e-6) ||
      JSON.stringify([...active].sort()) !== JSON.stringify([...layers].sort())
    )
      throw new Error(`Authoritative pad geometry/layers mismatch ${id}`)
    if (obstacle.isPlated !== undefined && obstacle.isPlated !== plated)
      throw new Error(`Conflicting explicit plating ${id}`)
    obstacle.isPlated = plated
    if (!plated) continue
    const circular =
      land.hole_diameter ??
      (land.hole_width !== undefined &&
      land.hole_height !== undefined &&
      close(land.hole_width, land.hole_height)
        ? land.hole_width
        : undefined)
    if (circular === undefined) {
      if (land.hole_width !== undefined && land.hole_height !== undefined)
        obstacle.holeShape = "slot"
      // Otherwise leave the drill missing: there is no evidence for its shape.
      continue
    }
    if (!Number.isFinite(circular) || circular <= 0)
      throw new Error(`Invalid authoritative drill ${id}`)
    if (
      obstacle.holeDiameter !== undefined &&
      !close(obstacle.holeDiameter, circular)
    )
      throw new Error(`Conflicting explicit drill ${id}`)
    obstacle.holeShape = "circle"
    obstacle.holeDiameter = circular
  }
  return output
}
