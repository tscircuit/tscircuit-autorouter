import type { SimplifiedPcbTrace } from "lib/types"
import type { WitnessViaSite } from "./getPipeline9WitnessViaCertificate"
import { areCopperSweepsSeparated, type CopperPoint } from "./relativeCopperSweepGeometry"

type Input = { site: WitnessViaSite; target: CopperPoint; trace: SimplifiedPcbTrace; minimumClearance: number }
type Clearance = { status: "PASS" | "UNKNOWN"; reason: string }

/** Exact admission beyond the unchanged checker's tolerance: the final via
 * land must clear every target wire segment on every manufactured via layer.
 */
export function checkPipeline9RelativeViaTraceClearance({ site, target, trace, minimumClearance }: Input): Clearance {
  const unknown = (reason: string): Clearance => ({ status: "UNKNOWN", reason })
  const supported = (value: number): boolean => Number.isFinite(value) && (value === 0 || Math.abs(value) >= 2 ** -64 && Math.abs(value) <= 2 ** 64)
  if (![target.x, target.y, site.diameter / 2, minimumClearance].every(supported) || site.diameter <= 0 || minimumClearance < 0 || site.layers.length === 0 || site.layers.length > 10 || new Set(site.layers).size !== site.layers.length || site.layers.some((layer) => !/^(top|bottom|inner[1-8])$/.test(layer))) return unknown("Unsupported exact target-clearance domain")
  let segments = 0
  for (let index = 0; index + 1 < trace.route.length; index++) {
    const a = trace.route[index]!, b = trace.route[index + 1]!
    if (a.route_type !== "wire" || b.route_type !== "wire") continue
    if (a.layer !== b.layer) return unknown("Unmaterialized target wire layer transition")
    if (!site.layers.includes(a.layer)) continue
    const radius = Math.max(a.width, b.width) / 2
    if (![a.x, a.y, b.x, b.y, a.width, b.width, radius].every(supported) || a.width <= 0 || b.width <= 0) return unknown("Unsupported target wire material")
    segments++
    if (!areCopperSweepsSeparated({ points: [target], radius: site.diameter / 2 }, { points: [a, b], radius }, minimumClearance)) return unknown("The final via lacks exact clearance from every foreign target segment")
  }
  return segments === 0 ? unknown("No manufactured-layer target segments were checked") : { status: "PASS", reason: "Every target segment has exact clearance beyond the declared minimum on the manufactured span" }
}
