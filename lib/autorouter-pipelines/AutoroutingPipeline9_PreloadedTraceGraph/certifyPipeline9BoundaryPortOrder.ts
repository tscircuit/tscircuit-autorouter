import type { HyperGraphHg, RegionHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

type Rectangle = { minX: number; maxX: number; minY: number; maxY: number }
type Family = { key: string; z: number; side: number; start: number; end: number; epsilon: number }

const rectangle = (region: RegionHg): Rectangle => ({
  minX: region.d.center.x - region.d.width / 2,
  maxX: region.d.center.x + region.d.width / 2,
  minY: region.d.center.y - region.d.height / 2,
  maxY: region.d.center.y + region.d.height / 2,
})

/** A unique physical shared segment; only roundoff may separate its two faces. */
const commonFamily = (
  region: RegionHg,
  other: RegionHg,
  point: { x: number; y: number; z: number },
): Family | null => {
  const a = rectangle(region), b = rectangle(other)
  const dimensions = [region.d.width, region.d.height, other.d.width, other.d.height]
  const values = [...Object.values(a), ...Object.values(b), point.x, point.y, ...dimensions]
  if (!values.every(Number.isFinite) || dimensions.some((value) => value <= 0) ||
    !Number.isSafeInteger(point.z) || point.z < 0) return null
  const epsilon = 32 * Number.EPSILON * Math.max(1, ...values.map(Math.abs))
  if (epsilon > Math.min(...dimensions) * 1e-8) return null
  for (const [owner, physical] of [[region, a], [other, b]] as const) {
    const declared = (owner.d as typeof owner.d & { bounds?: Rectangle }).bounds
    if (declared && (Object.keys(physical) as Array<keyof Rectangle>).some((key) =>
      !Number.isFinite(declared[key]) || Math.abs(declared[key] - physical[key]) > epsilon)) return null
  }
  const vertical = Math.abs(a.maxX - b.minX) <= epsilon ? 2
    : Math.abs(a.minX - b.maxX) <= epsilon ? 0 : -1
  const horizontal = Math.abs(a.maxY - b.minY) <= epsilon ? 3
    : Math.abs(a.minY - b.maxY) <= epsilon ? 1 : -1
  const families: Family[] = []
  const key = JSON.stringify([region.regionId, other.regionId].sort())
  if (vertical >= 0) {
    const start = Math.max(a.minY, b.minY), end = Math.min(a.maxY, b.maxY)
    const face = vertical === 2 ? a.maxX : a.minX
    if (end - start > epsilon && Math.abs(point.x - face) <= epsilon &&
      point.y >= start - epsilon && point.y <= end + epsilon) {
      families.push({ key, z: point.z, side: vertical, start, end, epsilon })
    }
  }
  if (horizontal >= 0) {
    const start = Math.max(a.minX, b.minX), end = Math.min(a.maxX, b.maxX)
    const face = horizontal === 3 ? a.maxY : a.minY
    if (end - start > epsilon && Math.abs(point.y - face) <= epsilon &&
      point.x >= start - epsilon && point.x <= end + epsilon) {
      families.push({ key, z: point.z, side: horizontal, start, end, epsilon })
    }
  }
  if (families.length !== 1) return null
  const family = families[0]!
  const onVertical = Math.abs(point.x - a.minX) <= epsilon || Math.abs(point.x - a.maxX) <= epsilon
  const onHorizontal = Math.abs(point.y - a.minY) <= epsilon || Math.abs(point.y - a.maxY) <= epsilon
  if (onVertical === onHorizontal || point.x < a.minX - epsilon || point.x > a.maxX + epsilon ||
    point.y < a.minY - epsilon || point.y > a.maxY + epsilon) return null
  return family
}

/** Promise order only for disjoint side families on exact physical rectangles.
 * The opt-in Tiny producer bounds every future duplicate to this common edge;
 * the opt-in Uniform distributor keeps fixed anchors and each family's order.
 */
export const certifyPipeline9BoundaryPortOrder = ({
  graph,
  terminalRegionIds,
}: {
  graph: HyperGraphHg
  terminalRegionIds: ReadonlySet<string>
}): number => {
  let certified = 0
  for (const region of graph.regions) {
    if (region.d.boundaryPortOrderPreserved !== undefined) {
      const { boundaryPortOrderPreserved: _oldCertificate, ...data } = region.d
      region.d = data
    }
    // The adapter injects exact terminal ports after this pass. Their source
    // regions cannot promise that all future ports lie on a common boundary.
    if (terminalRegionIds.has(region.regionId) ||
      region.d.layerChangeAllowedNetIds === undefined || region.ports.length === 0) continue
    const families = new Map<string, Family>()
    let proven = true
    for (const port of region.ports) {
      const other = port.region1.regionId === region.regionId ? port.region2
        : port.region2.regionId === region.regionId ? port.region1 : null
      if (!other || other.regionId === region.regionId) { proven = false; break }
      const family = commonFamily(region, other as RegionHg, port.d)
      if (!family) { proven = false; break }
      families.set(`${family.z}:${family.side}:${family.key}`, family)
    }
    if (!proven) continue
    const groups = new Map<string, Family[]>()
    for (const family of families.values()) {
      const key = `${family.z}:${family.side}`
      const group = groups.get(key) ?? []
      group.push(family)
      groups.set(key, group)
    }
    for (const group of groups.values()) {
      group.sort((a, b) => a.start - b.start || a.end - b.end)
      for (let i = 1; i < group.length; i++) {
        const previous = group[i - 1]!, next = group[i]!
        if (previous.end > next.start + Math.max(previous.epsilon, next.epsilon)) {
          proven = false
          break
        }
      }
      if (!proven) break
    }
    if (proven) {
      region.d = { ...region.d, boundaryPortOrderPreserved: true }
      certified++
    }
  }
  return certified
}
