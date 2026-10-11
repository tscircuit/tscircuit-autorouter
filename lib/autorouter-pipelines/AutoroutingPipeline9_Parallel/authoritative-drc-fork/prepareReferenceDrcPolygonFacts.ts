import type { Polygon } from "@flatten-js/core"
import type Flatbush from "flatbush"
import type { ReferenceDrcPrimitiveMemo, ReferenceDrcPrimitiveMissPlan } from "./ReferenceDrcPrimitiveMemo"
import { prepareReferenceDrcPrimitiveMissPlan } from "./referenceDrcPrimitiveMissPlanning"
import { isPrivatelyOwnedReferenceDrcPrimitiveMemo } from "./native/lib/check-traces-are-contiguous/check-traces-are-contiguous"
import { captureReferenceDrcPolygonSnapshotsWithinDomain } from "./referenceDrcPolygonFacts"
import { prepareParallelReferenceContinuityContext } from "../parallelReferenceContinuityKernel"
import type { ParallelReferenceContinuityBatch, ParallelReferenceContinuityFact, ParallelReferenceContinuityTask } from "../parallelReferenceContinuityTypes"
import { assertParallelReferenceContinuityBatchResult } from "../nativeSyncReferenceProtocol"
import { canAdmitNativeSyncReferenceFacts, isNativeSyncReferenceFactExecutor } from "../NativeSyncReferenceBatchTransport"
import type { ReferenceDrcTracePairFactExecutor } from "./prepareReferenceDrcTracePairFacts"
import { referenceDrcWorkerGeometryToleranceIsPinned } from "./canUseExpectedPortsMemo"

type PolygonConductor = { id: string; layers: string[]; polygon: Polygon; bridges: boolean; geometryId: number }
export type PreparedReferenceDrcPolygonFacts = { consume(left: number, right: number, nativePredicate: () => boolean): boolean; finish(): void }
const applyNative = Reflect.apply
const NativeWeakMap = WeakMap
const weakMapGet = WeakMap.prototype.get
const weakMapSet = WeakMap.prototype.set
const MAX_ROWS = 90_000
let nextSnapshotId = 1

/**
 * Runs only after original construction/interning/scaled memo/index.finish.
 * Original Native polygons and graph objects never cross the worker boundary.
 * The local shadow plan and snapshots consume no native counters/FIFO entries.
 */
export function prepareReferenceDrcPolygonFacts(
  memo: ReferenceDrcPrimitiveMemo | undefined,
  conductors: readonly PolygonConductor[],
  index: Flatbush,
  tolerance: number,
  executor: ReferenceDrcTracePairFactExecutor | undefined,
): PreparedReferenceDrcPolygonFacts | undefined {
  if (!referenceDrcWorkerGeometryToleranceIsPinned) return undefined
  if (memo === undefined || executor === undefined || !isPrivatelyOwnedReferenceDrcPrimitiveMemo(memo) || !isNativeSyncReferenceFactExecutor(executor) || !canAdmitNativeSyncReferenceFacts(executor)) return undefined
  const pairs: { left: number; right: number }[] = []
  const rows: { kind: string; input: number[] }[] = []
  for (let i = 0; i < conductors.length; i++) {
    const a = conductors[i]!
    if (!a.bridges) continue
    const box = a.polygon.box
    const neighbors = index.search(box.xmin - tolerance, box.ymin - tolerance, box.xmax + tolerance, box.ymax + tolerance)
    for (let k = 0; k < neighbors.length; k++) {
      const j = neighbors[k]!, b = conductors[j]!
      if (i === j || a.id === b.id || (b.bridges && j < i) || !a.layers.some((layer) => b.layers.includes(layer))) continue
      if (rows.length >= MAX_ROWS) return undefined
      pairs.push({ left: i, right: j })
      rows.push({ kind: "polygon-contact", input: [a.geometryId, b.geometryId, tolerance] })
    }
  }
  if (rows.length === 0) return undefined
  const plan = prepareReferenceDrcPrimitiveMissPlan(memo, rows)
  if (plan === undefined) return undefined
  const tasks: ParallelReferenceContinuityTask[] = []
  const polygons: Polygon[] = []
  const polygonIndexes = new NativeWeakMap<Polygon, number>()
  for (let row = 0; row < plan.rows.length; row++) {
    if (plan.rows[row]!.hit) continue
    const pair = pairs[row]!
    const left = addOwnedPolygon(conductors[pair.left]!.polygon, polygons, polygonIndexes)
    const right = addOwnedPolygon(conductors[pair.right]!.polygon, polygons, polygonIndexes)
    tasks.push({ kind: "native-polygon-contact-miss", rowIndex: row, leftPolygonIndex: left, rightPolygonIndex: right })
  }
  if (tasks.length === 0) return undefined
  const snapshots = captureReferenceDrcPolygonSnapshotsWithinDomain(polygons)
  // Scaled overflow/resource exclusion is a pure before-dispatch domain decline.
  if (snapshots === undefined) return undefined
  const context = prepareParallelReferenceContinuityContext({ snapshotId: nextSnapshotId++, portCount: 0, tracePortOrdinals: [], components: [], geometryPolygons: snapshots, geometryTolerance: tolerance })
  const batch: ParallelReferenceContinuityBatch = { kind: "referenceContinuityFacts", context, tasks }
  const result = executor(batch)
  if (result === undefined) return undefined
  assertParallelReferenceContinuityBatchResult(result, batch)
  const factsByRow: (ParallelReferenceContinuityFact | undefined)[] = new Array(rows.length)
  for (let i = 0; i < result.facts.length; i++) factsByRow[result.facts[i]!.rowIndex] = result.facts[i]
  let nextRow = 0
  return {
    consume: (left: number, right: number, nativePredicate: () => boolean): boolean => {
      const row = nextRow++, pair = pairs[row]
      if (pair === undefined || pair.left !== left || pair.right !== right) throw new Error(`Prepared reference DRC polygon order changed at row ${row}`)
      return consumePreparedPolygonRow(plan, rows[row]!.input, factsByRow[row], nativePredicate)
    },
    finish: (): void => {
      if (nextRow !== pairs.length) throw new Error("Prepared reference DRC polygons were not fully consumed")
      plan.finish()
    },
  }
}

function addOwnedPolygon(polygon: Polygon, polygons: Polygon[], indexes: WeakMap<Polygon, number>): number {
  let index = applyNative(weakMapGet, indexes, [polygon]) as number | undefined
  if (index === undefined) {
    index = polygons.length
    applyNative(weakMapSet, indexes, [polygon, index])
    polygons.push(polygon)
  }
  return index
}

function consumePreparedPolygonRow(plan: ReferenceDrcPrimitiveMissPlan, input: number[], fact: ParallelReferenceContinuityFact | undefined, nativePredicate: () => boolean): boolean {
  return plan.consume("polygon-contact", input, (): boolean => {
    if (fact === undefined) throw new Error("Prepared reference DRC polygon miss has no validated fact")
    if (fact.status === "exception") {
      nativePredicate()
      throw new Error("Prepared reference DRC polygon exception did not reproduce")
    }
    return fact.value
  })
}
