import type { Obstacle } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/** Prove that roundoff-separated graph sites touch the same physical pad. */
export function certifyElectricalTreePadAttachment(input: {
  terminal: PortPoint
  attachment: PortPoint
  obstacles: readonly Obstacle[]
  layerCount: number
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
    if (obstacle.isNonPlatedHole || obstacle.isCopperPour || obstacle.netIsAssignable ||
      !obstacle.connectedTo.includes(terminal.electricalTerminalId) ||
      ![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height,
        obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) ||
      obstacle.width <= 0 || obstacle.height <= 0 ||
      separation > Math.min(obstacle.width, obstacle.height) * 1e-9) continue
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
