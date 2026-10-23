import type { ConnectionPoint, Obstacle } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { getConnectionPointLayers } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export type ElectricalTreePadSourceTerminal = {
  netId: string
  sourceConnectionName: string
  sourceEndpointIndex: 0 | 1
  point: ConnectionPoint
}

/** Prove that roundoff-separated graph sites touch the same physical pad. */
export function certifyElectricalTreePadAttachment(input: {
  terminal: PortPoint
  attachment: PortPoint
  obstacles: readonly Obstacle[]
  layerCount: number
  netId?: string
  /** Compiler-trusted original demand endpoint, before any graph attachment. */
  sourceTerminal?: ElectricalTreePadSourceTerminal
}): number | undefined {
  const { terminal, attachment } = input
  if (!terminal.electricalTerminalId || terminal.electricalTerminalId !== terminal.pcb_port_id ||
    attachment.electricalTerminalId !== undefined || terminal.z !== attachment.z ||
    !Number.isInteger(terminal.z) || terminal.z < 0 || terminal.z >= input.layerCount ||
    ![terminal.x, terminal.y, attachment.x, attachment.y].every(Number.isFinite)) return undefined
  const scale = Math.max(1, Math.abs(terminal.x), Math.abs(terminal.y), Math.abs(attachment.x), Math.abs(attachment.y))
  const separation = Math.hypot(terminal.x - attachment.x, terminal.y - attachment.y)
  if (separation > Math.min(1e-9, 64 * Number.EPSILON * scale)) return undefined
  for (const [index, obstacle] of input.obstacles.entries()) {
    if (obstacle.isNonPlatedHole || obstacle.isCopperPour ||
      !obstacle.connectedTo.includes(terminal.electricalTerminalId) ||
      ![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height,
        obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) ||
      obstacle.width <= 0 || obstacle.height <= 0 ||
      separation > Math.min(obstacle.width, obstacle.height) * 1e-9) continue
    if (obstacle.netIsAssignable) {
      // Some imported physical pads also carry an assignable-net marker. That
      // marker alone is no conductor proof: require the exact immutable source
      // endpoint and the actual pad's independent identity before normalizing
      // its machine-roundoff attachment. Generic assignable geometry stays live.
      const source = input.sourceTerminal
      const metadata = obstacle.circuitJsonMetadata
      const padIds = [metadata?.pcb_smtpad_id, metadata?.pcb_plated_hole_id]
        .filter((id) => typeof id === "string" && id.length > 0)
      if (!source || !input.netId || source.netId !== input.netId ||
        !source.sourceConnectionName ||
        (source.sourceEndpointIndex !== 0 && source.sourceEndpointIndex !== 1) ||
        source.point.pcb_port_id !== terminal.electricalTerminalId ||
        source.point.x !== terminal.x || source.point.y !== terminal.y ||
        !getConnectionPointLayers(source.point).some((layer) => mapLayerNameToZ(layer, input.layerCount) === terminal.z) ||
        metadata?.pcb_port_id !== terminal.electricalTerminalId ||
        padIds.length !== 1 || !obstacle.connectedTo.includes(padIds[0]!) ||
        metadata.pcb_via_id !== undefined) continue
    }
    const layers = obstacle.__zLayers ?? obstacle.zLayers ??
      obstacle.layers.map((layer) => mapLayerNameToZ(layer, input.layerCount))
    if (!layers.every((z) => Number.isInteger(z) && z >= 0 && z < input.layerCount) ||
      !layers.includes(terminal.z)) continue
    const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const contained = [terminal, attachment].every((point) => {
      const x = point.x - obstacle.center.x, y = point.y - obstacle.center.y
      return obstacle.shape === "circle"
        ? Math.hypot(x, y) <= Math.min(obstacle.width, obstacle.height) / 2
        : Math.abs(x * cos + y * sin) <= obstacle.width / 2 &&
          Math.abs(-x * sin + y * cos) <= obstacle.height / 2
    })
    if (contained) return index
  }
  return undefined
}
