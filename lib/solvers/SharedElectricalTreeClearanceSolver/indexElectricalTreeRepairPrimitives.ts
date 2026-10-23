import type { ElectricalTreeRepairSegmentIdentity } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createElectricalTreeRepairWalks"

type PrimitiveVertex = { id: number; x: number; y: number }
type Primitive = {
  a: PrimitiveVertex
  b: PrimitiveVertex
  minZ: number
  maxZ: number
  radius: number
  net: string
  via: boolean
  sourceIdentity: ElectricalTreeRepairSegmentIdentity
}

/** Intern source-owned constraint variants after all occurrence locks/radii exist. */
export function indexElectricalTreeRepairPrimitives<T extends Primitive>(primitives: T[]): {
  primitives: T[]
  stats: Record<string, number>
} {
  const bindings = new Map<string, string>()
  const variants = new Map<string, number>()
  const variantsPerSource = new Map<string, number>()
  const representatives = new Set<number>()
  const capRadii = new Map<string, number>()
  const wireSites = new Map<string, number>()
  let physicalReferences = 0, mergedReferences = 0, seamReferences = 0
  let coveredSeams = 0, retainedSites = 0, mergedSites = 0
  let keyCharacters = 0, keyProbes = 0, coverageProbes = 0, capUpdates = 0
  const capKey = (primitive: T, vertex: PrimitiveVertex): string => {
    // A coordinate variable alone cannot certify a different owner or layer.
    const key = JSON.stringify([primitive.net, primitive.minZ, vertex.id])
    keyCharacters += key.length
    return key
  }
  for (let index = 0; index < primitives.length; index++) {
    const primitive = primitives[index]!, identity = primitive.sourceIdentity
    if (primitive.via && (primitive.a.x !== primitive.b.x || primitive.a.y !== primitive.b.y)) {
      throw new Error("Electrical tree primitive has a diagonal active via")
    }
    if (identity.kind !== "physical") continue
    physicalReferences++
    const source = `${identity.sourceRouteIndex}:${identity.sourceSegmentIndex}`
    const start = identity.reversed ? primitive.b : primitive.a
    const end = identity.reversed ? primitive.a : primitive.b
    const binding = JSON.stringify([primitive.net, start.id, end.id, primitive.via, primitive.minZ, primitive.maxZ])
    const previous = bindings.get(source)
    keyProbes++
    keyCharacters += source.length + binding.length
    if (previous !== undefined && previous !== binding) throw new Error(`Electrical tree source adjacency ${source} has contradictory ownership or endpoints`)
    bindings.set(source, binding)
    // Outgoing-width transport during reversal can produce legitimate distinct
    // conservative native radii. Keep every exact variant, not just the first.
    const variant = JSON.stringify([source, binding, primitive.radius])
    keyCharacters += variant.length
    keyProbes++
    if (variants.has(variant)) {
      mergedReferences++
      continue
    }
    variants.set(variant, index)
    variantsPerSource.set(source, (variantsPerSource.get(source) ?? 0) + 1)
    representatives.add(index)
    if (!primitive.via && primitive.a !== primitive.b && primitive.minZ === primitive.maxZ) {
      for (const vertex of [primitive.a, primitive.b]) {
        const key = capKey(primitive, vertex)
        capRadii.set(key, Math.max(capRadii.get(key) ?? 0, primitive.radius))
        capUpdates++
      }
    }
  }
  for (let index = 0; index < primitives.length; index++) {
    const primitive = primitives[index]!
    if (primitive.sourceIdentity.kind !== "adapter-seam") continue
    seamReferences++
    if (primitive.via || primitive.a !== primitive.b || primitive.minZ !== primitive.maxZ) {
      throw new Error("Electrical tree adapter seam is not an exact same-layer point")
    }
    coverageProbes++
    const cap = capRadii.get(capKey(primitive, primitive.a))
    // A via disk alone is not rule dominance: native via-via and via-pad gaps
    // can differ from this wire-class point's trace-clearance obligation.
    if (cap !== undefined && cap >= primitive.radius) {
      coveredSeams++
      continue
    }
    const site = JSON.stringify([primitive.net, primitive.minZ, primitive.a.id, primitive.radius])
    keyCharacters += site.length
    keyProbes++
    if (wireSites.has(site)) {
      mergedSites++
      continue
    }
    wireSites.set(site, index)
    representatives.add(index)
    retainedSites++
  }
  const retained = primitives.filter((_, index) => representatives.has(index))
  return { primitives: retained, stats: {
    treePrimitiveRawActiveReferences: primitives.length,
    treePrimitiveSourceReferences: physicalReferences,
    treePrimitiveDistinctSourceAdjacencies: bindings.size,
    treePrimitivePhysicalVariants: variants.size,
    treePrimitiveMultipleVariantSources: [...variantsPerSource.values()].filter((count) => count > 1).length,
    treePrimitiveMergedSourceReferences: mergedReferences,
    treePrimitiveManufacturedSeamReferences: seamReferences,
    treePrimitiveCoveredSeams: coveredSeams,
    treePrimitiveRetainedWireSites: retainedSites,
    treePrimitiveMergedWireSiteReferences: mergedSites,
    treePrimitiveActiveCount: retained.length,
    treePrimitiveActiveViaCount: retained.filter((primitive) => primitive.via).length,
    treePrimitiveActiveWireCount: retained.filter((primitive) => !primitive.via && primitive.a !== primitive.b).length,
    treePrimitiveActiveWireSiteCount: retained.filter((primitive) => !primitive.via && primitive.a === primitive.b).length,
    treePrimitiveIdentityKeyCharacters: keyCharacters,
    treePrimitiveIdentityProbes: keyProbes,
    treePrimitiveCapCoverageProbes: coverageProbes,
    treePrimitiveCapIndexUpdates: capUpdates,
    treePrimitiveSetupCapIndexEntries: capRadii.size,
    treePrimitiveSetupVariantIndexEntries: variants.size,
    treePrimitiveSetupSiteIndexEntries: wireSites.size,
  } }
}
