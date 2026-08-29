import RBush from "rbush"
import { expandBounds, getPrimitiveBounds } from "./exact-geometry"
import type { CompiledLayerRule, LayerName } from "./types"
import type {
  CopperVersion,
  HybridCopperId,
  HybridCopperPrimitive,
} from "./transactional-copper-types"

type IndexedCopper = {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  readonly copperId: HybridCopperId
  readonly primitive: HybridCopperPrimitive
}

type LayerIndex = {
  readonly layer: LayerName
  readonly tree: RBush<IndexedCopper>
}

export class VersionedHybridSpatialIndex {
  private readonly layerStack: readonly CompiledLayerRule[]
  private readonly layerIndexes: readonly LayerIndex[]
  private _version: CopperVersion

  constructor({
    layerStack,
    primitives,
    version,
  }: {
    layerStack: readonly CompiledLayerRule[]
    primitives: readonly HybridCopperPrimitive[]
    version: CopperVersion
  }) {
    this.layerStack = layerStack
    this._version = version
    this.layerIndexes = layerStack.map((layer) => ({
      layer: layer.name,
      tree: new RBush<IndexedCopper>(),
    }))
    for (const primitive of primitives) this.insertPrimitive(primitive)
  }

  get version(): CopperVersion {
    return this._version
  }

  query({
    primitive,
    clearanceMm,
    excludedCopperIds,
  }: {
    primitive: HybridCopperPrimitive
    clearanceMm: number
    excludedCopperIds: ReadonlySet<HybridCopperId>
  }): readonly HybridCopperPrimitive[] {
    const searchBounds = expandBounds({
      bounds: getPrimitiveBounds(primitive),
      distanceMm: clearanceMm,
    })
    const candidates: HybridCopperPrimitive[] = []
    const seenCopperIds = new Set<HybridCopperId>()
    for (const layer of this.getPrimitiveLayers(primitive)) {
      const layerIndex = this.layerIndexes.find(
        (candidate) => candidate.layer === layer,
      )
      if (!layerIndex) continue
      const entries = layerIndex.tree.search(searchBounds)
      for (const entry of entries) {
        if (
          excludedCopperIds.has(entry.copperId) ||
          seenCopperIds.has(entry.copperId)
        ) {
          continue
        }
        seenCopperIds.add(entry.copperId)
        candidates.push(entry.primitive)
      }
    }
    return candidates
  }

  applyTransaction({
    removedCopperIds,
    addedPrimitives,
    nextVersion,
  }: {
    removedCopperIds: ReadonlySet<HybridCopperId>
    addedPrimitives: readonly HybridCopperPrimitive[]
    nextVersion: CopperVersion
  }): void {
    if (nextVersion !== this._version + 1) {
      throw new Error(
        `spatial index version must advance by one from ${this._version}, received ${nextVersion}`,
      )
    }
    for (const layerIndex of this.layerIndexes) {
      const removedEntries = layerIndex.tree
        .all()
        .filter((entry) => removedCopperIds.has(entry.copperId))
      for (const removedEntry of removedEntries) {
        layerIndex.tree.remove(
          removedEntry,
          (first, second) => first.copperId === second.copperId,
        )
      }
    }
    for (const primitive of addedPrimitives) this.insertPrimitive(primitive)
    this._version = nextVersion
  }

  private insertPrimitive(primitive: HybridCopperPrimitive): void {
    const bounds = getPrimitiveBounds(primitive)
    for (const layer of this.getPrimitiveLayers(primitive)) {
      const layerIndex = this.layerIndexes.find(
        (candidate) => candidate.layer === layer,
      )
      if (!layerIndex) {
        throw new Error(`cannot index copper on unknown layer ${layer}`)
      }
      layerIndex.tree.insert({
        ...bounds,
        copperId: primitive.copperId,
        primitive,
      })
    }
  }

  private getPrimitiveLayers(
    primitive: HybridCopperPrimitive,
  ): readonly LayerName[] {
    if (primitive.kind === "segment") return [primitive.layer]
    const startIndex = this.layerStack.findIndex(
      (layer) => layer.name === primitive.fromLayer,
    )
    const endIndex = this.layerStack.findIndex(
      (layer) => layer.name === primitive.toLayer,
    )
    if (startIndex < 0 || endIndex < 0) {
      throw new Error(
        `cannot resolve via span ${primitive.fromLayer} to ${primitive.toLayer}`,
      )
    }
    const minimumIndex = Math.min(startIndex, endIndex)
    const maximumIndex = Math.max(startIndex, endIndex)
    return this.layerStack
      .slice(minimumIndex, maximumIndex + 1)
      .map((layer) => layer.name)
  }
}
