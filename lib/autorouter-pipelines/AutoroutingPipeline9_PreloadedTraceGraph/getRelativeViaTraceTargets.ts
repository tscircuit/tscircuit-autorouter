import type { WitnessViaSite } from "./getPipeline9WitnessViaCertificate"
import { isCopperPointWithinRadius, type CopperPoint } from "./relativeCopperSweepGeometry"

type Input = {
  site: Pick<WitnessViaSite, "x" | "y" | "diameter" | "layers">
  start: CopperPoint; end: CopperPoint; wireWidth: number; wireLayer: string
  minimumClearance: number
}

/** Proposes geometry only; unchanged complete predicates and the relative
 * material/interface proof still decide every candidate. No via is invented.
 */
export function getRelativeViaTraceTargets(input: Input): CopperPoint[] {
  const { site, start, end, wireWidth, wireLayer, minimumClearance } = input
  const numbers = [site.x, site.y, site.diameter, start.x, start.y, end.x, end.y, wireWidth, minimumClearance]
  if (numbers.some((value) => !Number.isFinite(value) || Math.abs(value) > 2 ** 64 || value !== 0 && Math.abs(value) < 2 ** -64) ||
    site.diameter <= 0 || wireWidth <= 0 || minimumClearance < 0 || !site.layers.includes(wireLayer)) return []
  const dx = end.x - start.x, dy = end.y - start.y, squaredLength = dx * dx + dy * dy
  if (!Number.isFinite(squaredLength) || squaredLength <= 0) return []
  const ratio = Math.max(0, Math.min(1, ((site.x - start.x) * dx + (site.y - start.y) * dy) / squaredLength))
  const qx = start.x + ratio * dx, qy = start.y + ratio * dy
  const vx = site.x - qx, vy = site.y - qy, distance = Math.hypot(vx, vy)
  const gap = distance - site.diameter / 2 - wireWidth / 2
  const deficit = minimumClearance + 0.001 - gap
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(gap) || gap <= 0 || gap >= minimumClearance || !Number.isFinite(deficit) || deficit <= 0) return []
  return [1, 2, 4, 8].map((factor) => ({ x: site.x + vx / distance * deficit * factor, y: site.y + vy / distance * deficit * factor }))
    .filter((target) => Number.isFinite(target.x) && Number.isFinite(target.y) && isCopperPointWithinRadius(site, target, 0.25))
}
