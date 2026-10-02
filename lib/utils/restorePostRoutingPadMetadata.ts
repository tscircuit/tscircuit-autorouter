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
  /** Explicit producer provenance for ID-less hole obstacles, never ownership
   * inferred from coordinates. Keys are authoritative pcb_hole IDs. */
  holeObstacleIndices: Readonly<Record<string, number>> = {},
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
  const representedPads = new Set<string>()
  for (const obstacle of output.obstacles) {
    const recorded = obstacle.circuitJsonMetadata
    const ownId = obstacle.connectedTo[0]
    const id = recorded?.pcb_plated_hole_id ?? recorded?.pcb_smtpad_id ??
      (ownId && pads.has(ownId) ? ownId : undefined)
    if (!id) continue
    const source = pads.get(id)
    if (!source) {
      obstacle.unsupportedPhysicalGeometry = `Referenced source pad absent: ${id}`
      continue
    }
    representedPads.add(id)
    if (source.type !== "pcb_plated_hole" && source.type !== "pcb_smtpad")
      throw new Error(`Invalid pad source ${id}`)
    const metadata = obstacle.circuitJsonMetadata ??= source.type === "pcb_plated_hole"
      ? { pcb_plated_hole_id: id } : { pcb_smtpad_id: id }
    if (metadata?.pcb_port_id && source.pcb_port_id !== metadata.pcb_port_id) {
      // The legacy producer's repeated-pad block contains a source-port alias
      // before its PCB port. Correct that known migration only with the exact
      // source pad ID and its authoritative PCB port already in the input.
      const ownBlock = obstacle.connectedTo.lastIndexOf(id)
      if (obstacle.connectedTo[0] !== id || ownBlock < 0 ||
        obstacle.connectedTo[ownBlock + 1] !== metadata.pcb_port_id ||
        !source.pcb_port_id || obstacle.connectedTo[ownBlock + 2] !== source.pcb_port_id)
        throw new Error(`Authoritative pad port mismatch ${id}`)
      metadata.pcb_port_id = source.pcb_port_id
    }
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
      corner_radius?: number
    }
    const supported = plated
      ? ["circle", "pill", "oval", "circular_hole_with_rect_pad"]
      : ["circle", "rect", "rotated_rect", "pill", "oval"]
    if (!supported.includes(land.shape)) {
      obstacle.unsupportedPhysicalGeometry = `source land shape ${land.shape}`
      continue
    }
    if (
      (land.hole_offset_x ?? 0) !== 0 ||
      (land.hole_offset_y ?? 0) !== 0
    ) {
      obstacle.unsupportedPhysicalGeometry = "offset drill"
      continue
    }
    const expectedType =
      land.shape === "circle"
        ? "circle"
        : land.shape === "circular_hole_with_rect_pad" || land.shape === "rect" ||
            land.shape === "rotated_rect"
          ? "rect"
          : "oval"
    // SRJ's canonical oval with equal axes is exactly a circular land.
    const circleAsOval =
      land.shape === "circle" &&
      (obstacle.type as string) === "oval" &&
      close(obstacle.width, obstacle.height)
    const capsuleEnvelope = expectedType === "oval" && obstacle.type === "rect"
    const inputShape = obstacle.shape === "circle" ? "circle" : obstacle.type
    if (inputShape !== expectedType && !circleAsOval && !capsuleEnvelope)
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
    const swappedQuarterTurn = width !== undefined && height !== undefined &&
      close(obstacle.width, height) && close(obstacle.height, width) &&
      Math.abs(rotationGap % 180 - 90) < 1e-6
    const sameAxes = width !== undefined && height !== undefined &&
      close(obstacle.width, width) && close(obstacle.height, height) &&
      (rotationEquivalent || rotationGap % 180 < 1e-6)
    if (
      !close(obstacle.center.x, land.x) ||
      !close(obstacle.center.y, land.y) ||
      width === undefined ||
      height === undefined ||
      (!sameAxes && !swappedQuarterTurn) ||
      JSON.stringify([...active].sort()) !== JSON.stringify([...layers].sort())
    )
      throw new Error(`Authoritative pad geometry/layers mismatch ${id}`)
    if (obstacle.isPlated !== undefined && obstacle.isPlated !== plated)
      throw new Error(`Conflicting explicit plating ${id}`)
    obstacle.isPlated = plated
    const cornerRadius = land.corner_radius ?? land.rect_pad_border_radius ?? land.border_radius
    if ((expectedType === "circle" || expectedType === "oval" || cornerRadius) &&
      obstacle.shape !== "circle")
      obstacle.routingEnvelope = {width: obstacle.width, height: obstacle.height,
        rotation: ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180}
    // Restore the exact land inside the producer's verified envelope. This is
    // an isolated physical input; original SRJ and routed copper stay intact.
    obstacle.landShape = expectedType
    obstacle.width = width
    obstacle.height = height
    obstacle.ccwRotationDegrees = land.ccw_rotation ?? land.rect_ccw_rotation ?? 0
    if (cornerRadius !== undefined) {
      if (!Number.isFinite(cornerRadius) || cornerRadius < 0 ||
        cornerRadius > Math.min(width, height) / 2)
        throw new Error(`Invalid authoritative corner radius ${id}`)
      obstacle.cornerRadius = cornerRadius
    }
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
  const missing = [...pads.keys()].filter((id) => !representedPads.has(id))
  const sourceHoles = new Map<string, AnyCircuitElement>()
  for (const element of circuitJson) {
    if (element.type !== "pcb_hole") continue
    if (sourceHoles.has(element.pcb_hole_id))
      throw new Error(`Duplicate authoritative hole ID ${element.pcb_hole_id}`)
    sourceHoles.set(element.pcb_hole_id, element)
  }
  const representedHoles = new Set<string>()
  const usedHoleObstacles = new Set<number>()
  for (const [id, index] of Object.entries(holeObstacleIndices)) {
    const hole = sourceHoles.get(id)
    const obstacle = output.obstacles[index]
    if (!hole || hole.type !== "pcb_hole" || !obstacle ||
      usedHoleObstacles.has(index) || obstacle.connectedTo.length ||
      obstacle.circuitJsonMetadata || obstacle.componentId !== hole.pcb_component_id)
      throw new Error(`Invalid authoritative hole obstacle mapping ${id}`)
    usedHoleObstacles.add(index)
    representedHoles.add(id)
    if (hole.hole_shape !== "circle") {
      obstacle.unsupportedPhysicalGeometry = `source non-plated hole shape ${hole.hole_shape}`
      continue
    }
    const diameter = hole.hole_diameter
    if (!Number.isFinite(diameter) || diameter <= 0 ||
      !close(obstacle.center.x, hole.x) || !close(obstacle.center.y, hole.y) ||
      !close(obstacle.width, diameter) || !close(obstacle.height, diameter))
      throw new Error(`Authoritative hole geometry mismatch ${id}`)
    obstacle.sourceHoleId = id
    obstacle.isNonPlatedHole = true
    obstacle.landShape = "circle"
    obstacle.holeDiameter = diameter
    obstacle.holeShape = "circle"
  }
  const missingHoles = [...sourceHoles.keys()].filter((id) => !representedHoles.has(id))
  const missingGeometry = [
    ...(missing.length ? [`Authoritative source pads absent from SRJ: ${missing.join(", ")}`] : []),
    ...(missingHoles.length ? [`Authoritative source holes lack obstacle provenance: ${missingHoles.join(", ")}`] : []),
  ]
  if (missingGeometry.length)
    output.unsupportedPhysicalGeometry = missingGeometry.join("; ")
  return output
}
