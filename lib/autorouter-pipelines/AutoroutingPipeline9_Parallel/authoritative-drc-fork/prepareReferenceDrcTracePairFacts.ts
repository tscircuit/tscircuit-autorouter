import type { PcbTrace } from "circuit-json"
import type { ReferenceDrcPrimitiveMemo, ReferenceDrcPrimitiveMissPlan } from "./ReferenceDrcPrimitiveMemo"
import { prepareReferenceDrcPrimitiveMissPlan } from "./referenceDrcPrimitiveMissPlanning"
import { isPrivatelyOwnedReferenceDrcPrimitiveMemo } from "./native/lib/check-traces-are-contiguous/check-traces-are-contiguous"
import { prepareParallelReferenceContinuityContext } from "../parallelReferenceContinuityKernel"
import type { ParallelReferenceContinuityBatch, ParallelReferenceContinuityBatchResult, ParallelReferenceContinuityFact, ParallelReferenceContinuityTask } from "../parallelReferenceContinuityTypes"
import { assertParallelReferenceContinuityBatchResult } from "../nativeSyncReferenceProtocol"
import { canAdmitNativeSyncReferenceFacts, isNativeSyncReferenceFactExecutor } from "../NativeSyncReferenceBatchTransport"
import { referenceDrcWorkerGeometryToleranceIsPinned } from "./canUseExpectedPortsMemo"

export type ReferenceDrcTracePairFactExecutor = (batch: ParallelReferenceContinuityBatch) => ParallelReferenceContinuityBatchResult | undefined
export type PreparedReferenceDrcTracePairFacts = {
  consume(left: number, right: number, nativePredicate: () => boolean): boolean
  finish(): void
}
const applyNative = Reflect.apply
const NativeWeakMap = WeakMap
const weakMapGet = WeakMap.prototype.get
const weakMapSet = WeakMap.prototype.set
const MAX_ROWS = 4_000_000
let nextSnapshotId = 1

/** Only the already guarded private checker can prepare immutable miss inputs. */
export function prepareReferenceDrcTracePairFacts(
  memo: ReferenceDrcPrimitiveMemo | undefined,
  traces: PcbTrace[],
  traceGeometryIds: number[],
  candidates: Set<number>[],
  executor: ReferenceDrcTracePairFactExecutor | undefined,
): PreparedReferenceDrcTracePairFacts | undefined {
  if (!referenceDrcWorkerGeometryToleranceIsPinned) return undefined
  if (memo === undefined || executor === undefined || !isPrivatelyOwnedReferenceDrcPrimitiveMemo(memo) || !isNativeSyncReferenceFactExecutor(executor) || !canAdmitNativeSyncReferenceFacts(executor)) return undefined
  let rowCount = 0
  for (let i = 0; i < candidates.length; i++) rowCount += candidates[i]!.size
  if (rowCount === 0 || rowCount >= MAX_ROWS) return undefined
  const pairs: { left: number; right: number }[] = []
  const rows: { kind: string; input: number[] }[] = []
  for (let i = 0; i < candidates.length; i++) {
    const neighbors = [...candidates[i]!].sort((a, b) => a - b)
    for (let j = 0; j < neighbors.length; j++) {
      const right = neighbors[j]!
      pairs.push({ left: i, right })
      rows.push({ kind: "trace-pair", input: [traceGeometryIds[i]!, traceGeometryIds[right]!] })
    }
  }
  const plan = prepareReferenceDrcPrimitiveMissPlan(memo, rows)
  if (plan === undefined) return undefined
  const tasks: ParallelReferenceContinuityTask[] = []
  for (let i = 0; i < plan.rows.length; i++) {
    if (!plan.rows[i]!.hit) tasks.push({ kind: "native-trace-pair-miss", rowIndex: i, leftTraceIndex: pairs[i]!.left, rightTraceIndex: pairs[i]!.right })
  }
  // A fully warm evaluation occupies no worker and retains its native loop.
  if (tasks.length === 0) return undefined
  const context = prepareParallelReferenceContinuityContext({ snapshotId: nextSnapshotId++, portCount: 0, tracePortOrdinals: [], components: [], geometryTraces: copyNativeTracePairGeometry(traces) })
  const batch: ParallelReferenceContinuityBatch = { kind: "referenceContinuityFacts", context, tasks }
  const result = executor(batch)
  // Undefined is an explicit pre-dispatch availability/domain decline only.
  if (result === undefined) return undefined
  assertParallelReferenceContinuityBatchResult(result, batch)
  const factsByRow: (ParallelReferenceContinuityFact | undefined)[] = new Array(pairs.length)
  for (let i = 0; i < result.facts.length; i++) factsByRow[result.facts[i]!.rowIndex] = result.facts[i]
  let nextRow = 0
  return {
    consume: (left: number, right: number, nativePredicate: () => boolean): boolean => {
      const row = nextRow++
      const pair = pairs[row]
      if (pair === undefined || pair.left !== left || pair.right !== right) throw new Error(`Prepared reference DRC pair order changed at row ${row}`)
      return consumePreparedRow(plan, rows[row]!.input, factsByRow[row], nativePredicate)
    },
    finish: (): void => {
      if (nextRow !== pairs.length) throw new Error("Prepared reference DRC pairs were not fully consumed")
      plan.finish()
    },
  }
}

/**
 * The pinned circuit-json-to-connectivity-map predicate reads only route
 * length/index, route_type, the starting widths, and endpoint x/y. Its pinned
 * math-utils 0.0.9 leaf also reads only x/y. Original full objects remain the
 * memo/interner keys; these fresh worker objects are never published. Explicit
 * value copies preserve hidden data fields that structuredClone would drop.
 * Full private native admission has already excluded observers/sparse routes.
 */
function copyNativeTracePairGeometry(traces: PcbTrace[]): PcbTrace[] {
  type PointGeometry = { route_type: unknown; x: unknown; y: unknown; width: unknown }
  const copiedRoutes = new NativeWeakMap<object, PointGeometry[]>()
  const copiedPoints = new NativeWeakMap<object, PointGeometry>()
  const geometry: PcbTrace[] = []
  for (let traceIndex = 0; traceIndex < traces.length; traceIndex++) {
    const trace = traces[traceIndex]!
    let route = applyNative(weakMapGet, copiedRoutes, [trace.route]) as PointGeometry[] | undefined
    if (route === undefined) {
      route = []
      applyNative(weakMapSet, copiedRoutes, [trace.route, route])
      for (let pointIndex = 0; pointIndex < trace.route.length; pointIndex++) {
        const point = trace.route[pointIndex]! as unknown as Record<string, unknown>
        let copied = applyNative(weakMapGet, copiedPoints, [point]) as PointGeometry | undefined
        if (copied === undefined) {
          copied = { route_type: point.route_type, x: point.x, y: point.y, width: point.width }
          applyNative(weakMapSet, copiedPoints, [point, copied])
        }
        route.push(copied)
      }
    }
    geometry.push({ type: trace.type, pcb_trace_id: trace.pcb_trace_id, route } as unknown as PcbTrace)
  }
  return geometry
}

function consumePreparedRow(plan: ReferenceDrcPrimitiveMissPlan, input: number[], fact: ParallelReferenceContinuityFact | undefined, nativePredicate: () => boolean): boolean {
  return plan.consume("trace-pair", input, (): boolean => {
    if (fact === undefined) throw new Error("Prepared reference DRC miss has no validated fact")
    if (fact.status === "exception") {
      // Materialize the original native Error at its original ordered miss site.
      nativePredicate()
      throw new Error("Prepared reference DRC predicate exception did not reproduce")
    }
    return fact.value
  })
}
