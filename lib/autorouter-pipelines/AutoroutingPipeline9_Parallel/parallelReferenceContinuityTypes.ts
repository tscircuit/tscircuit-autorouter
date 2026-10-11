import type { PcbTrace } from "circuit-json"
import type { ReferenceDrcPolygonSnapshot } from "./authoritative-drc-fork/referenceDrcPolygonFacts"

/** Immutable, owner-prepared data for one original continuity invocation. */
export type ParallelReferenceContinuityContext = {
  snapshotId: number
  traceCount: number
  portCount: number
  /** Original pcbTraces.filter order, including distinct duplicate-ID objects. */
  componentOffsets: Uint32Array
  componentTraceIndexes: Uint32Array
  /** Each row uses the original final touched-port set for that trace ID. */
  touchedPortWords: Uint32Array
  /** Present only for already identified pure native geometry misses. */
  geometryTraces?: readonly PcbTrace[]
  /** Already-scaled Native parameters, never original copper generator inputs. */
  geometryPolygons?: readonly ReferenceDrcPolygonSnapshot[]
  geometryTolerance?: number
}

export type ParallelReferenceContinuityTask = {
  kind: "port-connectivity"
  rowIndex: number
  componentIndex: number
  portOrdinal: number
} | {
  kind: "native-trace-pair-miss"
  rowIndex: number
  leftTraceIndex: number
  rightTraceIndex: number
} | {
  kind: "native-polygon-contact-miss"
  rowIndex: number
  leftPolygonIndex: number
  rightPolygonIndex: number
}

export type ParallelReferenceContinuityFact = {
  status: "evaluated"
  rowIndex: number
  kind: ParallelReferenceContinuityTask["kind"]
  value: boolean
  /** The native ordered .some visits, or one actual native pair predicate. */
  consumedVisits: number
} | {
  status: "exception"
  rowIndex: number
  kind: "native-trace-pair-miss" | "native-polygon-contact-miss"
  consumedVisits: 1
  exception: { name: string; message: string; stack?: string }
}

export type ParallelReferenceContinuityBatch = {
  kind: "referenceContinuityFacts"
  context: ParallelReferenceContinuityContext
  tasks: readonly ParallelReferenceContinuityTask[]
}

export type ParallelReferenceContinuityBatchResult = {
  kind: "referenceContinuityFacts"
  snapshotId: number
  facts: ParallelReferenceContinuityFact[]
}

/** Local provenance remains on main; only these fact rows cross workers. */
export type ParallelReferenceContinuitySourceRows = {
  tracePortOrdinals: readonly (readonly number[])[]
  components: readonly (readonly number[])[]
  portCount: number
  snapshotId: number
  geometryTraces?: readonly PcbTrace[]
  geometryPolygons?: readonly ReferenceDrcPolygonSnapshot[]
  geometryTolerance?: number
}
