import { createHash } from "node:crypto"
import { originalOwners } from "./audit-retention-fixed-artifact"

type Json = any
const hash = (value: Json): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")

/** Original CJSON pad geometry remains separate from reconstructed SRJ checks. */
export const auditOriginalSourceViaPads = (original: Json, traces: Json[], circuit: Json[]): Json => {
  const owners = originalOwners(original)
  const stack = ["top", "inner1", "inner2", "bottom"]
  const requiredGap = original.minViaEdgeToPadEdgeClearance ?? 0.1
  const threshold = requiredGap - 0.005
  const vias = new Map<string, Json>()
  for (const trace of traces) for (const point of trace.route) {
    if (point.route_type !== "via") continue
    const owner = owners.trace(trace)
    const diameter = point.via_diameter ?? 0.3
    const key = hash([owner.owners, point.x, point.y, stack, diameter, point.via_hole_diameter ?? 0.15])
    vias.set(key, { x: point.x, y: point.y, radius: diameter / 2,
      siteSha256: key, owner, traceId: trace.pcb_trace_id })
  }
  const pads = circuit.filter((element) => element.type === "pcb_smtpad" || element.type === "pcb_plated_hole")
  const findings: Json[] = [], unknownContacts: Json[] = []
  let unsupportedSmtShapes = 0, unsupportedPlatedShapes = 0, unboundPadGeometry = 0
  let unresolvedPadOwners = 0, ownOwnerPairs = 0, provenFarPairs = 0, provenFarUnsupportedPairs = 0
  const sourceShapeCounts: Record<string, number> = {}
  for (const pad of pads) {
    const plated = pad.type === "pcb_plated_hole"
    const id = plated ? pad.pcb_plated_hole_id : pad.pcb_smtpad_id
    const declared = original.obstacles.filter((obstacle: Json) =>
      (plated ? obstacle.circuitJsonMetadata?.pcb_plated_hole_id : obstacle.circuitJsonMetadata?.pcb_smtpad_id) === id)
    const evidence = declared.map((obstacle: Json) => owners.obstacle(obstacle))
    if (pad.pcb_port_id) {
      const intrinsic = owners.resolveTokens([{ type: "pcb-port", value: pad.pcb_port_id }])
      if (intrinsic.status !== "unknown") evidence.push(intrinsic)
    }
    const knownOwners = new Set(evidence.flatMap((entry: Json) => entry.owners))
    const padOwner = { status: knownOwners.size === 1 && evidence.length > 0 && evidence.every((entry: Json) => entry.status === "resolved")
      ? "resolved" : knownOwners.size > 1 ? "ambiguous" : "unknown", owners: [...knownOwners].sort() }
    if (padOwner.status !== "resolved") unresolvedPadOwners++
    const circle = pad.shape === "circle"
    const width = circle ? (plated ? pad.outer_diameter : pad.radius * 2) : pad.width ?? pad.rect_pad_width
    const height = circle ? width : pad.height ?? pad.rect_pad_height
    const rotation = pad.ccw_rotation ?? pad.rotation ?? pad.ccwRotationDegrees ?? 0
    const finiteGeometry = [pad.x, pad.y, width, height, rotation].every(Number.isFinite) && width > 0 && height > 0
    const sourceLayers = plated ? pad.layers : [pad.layer]
    const layersKnown = Array.isArray(sourceLayers) && sourceLayers.length > 0 && sourceLayers.every((layer: string) => stack.includes(layer))
    const geometryBound = finiteGeometry && layersKnown && declared.some((obstacle: Json) =>
      Math.abs(obstacle.center.x - pad.x) <= 1e-8 && Math.abs(obstacle.center.y - pad.y) <= 1e-8 &&
      Math.abs(obstacle.width - width) <= 1e-8 && Math.abs(obstacle.height - height) <= 1e-8 &&
      Math.abs((obstacle.ccwRotationDegrees ?? 0) - rotation) <= 1e-8 &&
      sourceLayers.every((layer: string) => obstacle.layers.includes(layer)))
    if (!geometryBound) unboundPadGeometry++
    const simpleRectangle = pad.shape === "rect" && (pad.corner_radius ?? 0) === 0 && (pad.radius ?? 0) === 0
    const exactSupported = !plated && (circle || simpleRectangle)
    // Pill and rounded-rectangle copper is contained by its declared box.
    // This proves far separation only; it never fills an unknown body.
    const envelopeKnown = circle || pad.shape === "rect" || pad.shape === "pill"
    if (plated) unsupportedPlatedShapes++
    else if (!exactSupported) unsupportedSmtShapes++
    sourceShapeCounts[`${pad.type}:${pad.shape}`] = (sourceShapeCounts[`${pad.type}:${pad.shape}`] ?? 0) + 1
    for (const via of vias.values()) {
      if (via.owner.status === "resolved" && padOwner.status === "resolved" && via.owner.owners[0] === padOwner.owners[0]) {
        ownOwnerPairs++
        continue
      }
      const contact = { viaSiteSha256: via.siteSha256, traceId: via.traceId, padId: id,
        viaOwner: via.owner, padOwner, sourcePadType: pad.type, sourcePadShape: pad.shape }
      if (!geometryBound || !envelopeKnown) {
        unknownContacts.push({ ...contact, reason: !geometryBound ? "ORIGINAL_SOURCE_PAD_GEOMETRY_NOT_BOUND_TO_SRJ" : "SOURCE_BODY_ENVELOPE_UNPROVEN" })
        continue
      }
      const angle = -rotation * Math.PI / 180
      const dx = via.x - pad.x, dy = via.y - pad.y
      const x = dx * Math.cos(angle) - dy * Math.sin(angle)
      const y = dx * Math.sin(angle) + dy * Math.cos(angle)
      const ex = Math.abs(x) - width / 2, ey = Math.abs(y) - height / 2
      const envelopeGap = circle ? Math.hypot(dx, dy) - width / 2 - via.radius
        : Math.hypot(Math.max(ex, 0), Math.max(ey, 0)) + Math.min(Math.max(ex, ey), 0) - via.radius
      if (Math.max(0, envelopeGap) >= threshold) {
        provenFarPairs++
        if (!exactSupported) provenFarUnsupportedPairs++
        continue
      }
      if (!exactSupported || via.owner.status !== "resolved" || padOwner.status !== "resolved") {
        unknownContacts.push({ ...contact, reason: !exactSupported ? "ORIGINAL_SOURCE_COPPER_BODY_NOT_EXACTLY_AUDITED" : "ORIGINAL_TYPED_OWNERSHIP_UNRESOLVED",
          conservativeEnvelopeGapMm: envelopeGap })
      } else findings.push({ ...contact, signedOriginalSourceCopperGapMm: envelopeGap,
        requiredGapMm: requiredGap, toleranceMm: 0.005, verdict: "CONFIRMED_FOREIGN_ORIGINAL_OWNER_VIA_PAD_VIOLATION" })
    }
  }
  return { scope: "Independent final-copper check against hash-bound original source CJSON pad bodies; no routing",
    status: unsupportedSmtShapes || unsupportedPlatedShapes || unboundPadGeometry ? "PARTIAL_SOURCE_SHAPE_COVERAGE" : "COMPLETE_SOURCE_SHAPE_COVERAGE",
    globalOriginalSourceViaPadClearancePassed: unsupportedSmtShapes || unsupportedPlatedShapes || unboundPadGeometry || unknownContacts.length ? null : findings.length === 0,
    uniqueManufacturedViaSites: vias.size, originalSourcePadCount: pads.length,
    sourceShapeCounts, unsupportedSmtShapes, unsupportedPlatedShapes, unboundPadGeometry, unresolvedPadOwners,
    ownOwnerPairs, provenFarPairs, provenFarUnsupportedPairs,
    confirmedForeignViolationCount: findings.length, confirmedForeignViolations: findings,
    unresolvedNearOrUnboundContactCount: unknownContacts.length, unresolvedContacts: unknownContacts,
    limits: "Rounded rectangles, pills and plated drill voids never become filled copper. Known source envelopes prove far separation only. Unsupported source bodies remain explicit even when no near contact is found. Exact typed original declarations define owners; matching source IDs and geometry bind bodies, never union owners." }
}
