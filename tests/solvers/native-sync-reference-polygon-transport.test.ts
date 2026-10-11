import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { Arc, Point, Polygon, Segment } from "@flatten-js/core"
import { Pipeline9LocalWorkerPool, getNativeSyncReferencePoolBinding } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { createNativeSyncReferenceFactExecutor, initializeNativeSyncReferenceTransport } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/NativeSyncReferenceBatchTransport"
import { executeParallelReferenceContinuityBatch, prepareParallelReferenceContinuityContext } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityKernel"
import type { ParallelReferenceContinuityBatch, ParallelReferenceContinuityBatchResult } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityTypes"
import { captureReferenceDrcPolygonSnapshot } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/referenceDrcPolygonFacts"
import { assertNativeSyncReferenceResponse, assertParallelReferenceContinuityBatchResult, nativeSyncReferenceSchema,
  nativeSyncReferenceSchemaHash, type NativeSyncReferenceIdentity } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/nativeSyncReferenceProtocol"

test("scaled polygon facts cross the native four-core transport with strict all-row protocol and fatal constructor faults", async () => {
  await initializeNativeSyncReferenceTransport()
  const rectangle = (x: number, y: number, width: number, height: number): Polygon => {
    const polygon = new Polygon()
    const points = [new Point(x, y), new Point(x + width, y), new Point(x + width, y + height), new Point(x, y + height)]
    polygon.addFace(points.map((point, index): Segment => new Segment(point, points[(index + 1) % points.length]!)))
    return polygon
  }
  const circle = new Polygon()
  circle.addFace([new Arc(new Point(2, 1), 1, 0, 2 * Math.PI, true)])
  const polygons = [rectangle(-0, 0, 2, 2), rectangle(1, 1, 2, 2), rectangle(9, 9, 1, 1), circle]
  const context = prepareParallelReferenceContinuityContext({ snapshotId: 91, portCount: 2,
    tracePortOrdinals: [[0], [1]], components: [[0, 1]],
    geometryTraces: [
      { type: "pcb_trace", pcb_trace_id: "left", route: [{ route_type: "wire", layer: "top", x: 0, y: 0, width: 0.1 }, { route_type: "wire", layer: "top", x: 2, y: 2, width: 0.1 }] },
      { type: "pcb_trace", pcb_trace_id: "right", route: [{ route_type: "wire", layer: "top", x: 0, y: 2, width: 0.1 }, { route_type: "wire", layer: "top", x: 2, y: 0, width: 0.1 }] },
    ], geometryPolygons: polygons.map(captureReferenceDrcPolygonSnapshot), geometryTolerance: 0.01 })
  const batch: ParallelReferenceContinuityBatch = { kind: "referenceContinuityFacts", context, tasks: [
    { kind: "native-polygon-contact-miss", rowIndex: 20, leftPolygonIndex: 0, rightPolygonIndex: 1 },
    { kind: "native-polygon-contact-miss", rowIndex: 21, leftPolygonIndex: 0, rightPolygonIndex: 2 },
    { kind: "native-polygon-contact-miss", rowIndex: 22, leftPolygonIndex: 0, rightPolygonIndex: 3 },
    { kind: "native-polygon-contact-miss", rowIndex: 23, leftPolygonIndex: 2, rightPolygonIndex: 3 },
    { kind: "native-trace-pair-miss", rowIndex: 24, leftTraceIndex: 0, rightTraceIndex: 1 },
    { kind: "port-connectivity", rowIndex: 25, componentIndex: 0, portOrdinal: 1 },
  ] }
  const original = structuredClone(batch)
  const expected = executeParallelReferenceContinuityBatch(batch)
  expect(expected.facts.map((fact): unknown => fact.status === "evaluated" ? fact.value : fact.exception.name)).toEqual([true, false, true, false, true, true])
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    await pool.initializeReferenceTransport()
    await pool.warmup()
    const executor = createNativeSyncReferenceFactExecutor(pool)!
    expect(executor(batch)).toEqual(expected)
    expect(executor(batch)).toEqual(expected)
    expect(batch).toEqual(original)
    const book = getNativeSyncReferencePoolBinding(pool)!.book
    expect(book.stats.workersReserved).toBe(6)
    expect(book.stats.workersRetired).toBe(6)
    expect(book.stats.batchesCompleted).toBe(2)
    expect(book.stats.factRowsCompleted + book.stats.mainFactRowsCompleted).toBe(12)
    expect(book.stats.mainFactRowsCompleted).toBeGreaterThan(0)
    await pool.warmup()
    expect(pool.stats.maxActiveWorkers).toBe(4)
  } finally { pool.dispose() }

  expect(createHash("sha256").update(nativeSyncReferenceSchema).digest("hex")).toBe(nativeSyncReferenceSchemaHash)
  const identity: NativeSyncReferenceIdentity = { schema: nativeSyncReferenceSchema, schemaHash: nativeSyncReferenceSchemaHash,
    reservationId: 1, ordinal: 0, laneCount: 3, snapshotId: context.snapshotId, taskCount: batch.tasks.length }
  const response = { ...identity, status: "evaluated", result: expected }
  expect(() => assertNativeSyncReferenceResponse(response, identity, batch)).not.toThrow()
  const exceptionResult: ParallelReferenceContinuityBatchResult = structuredClone(expected)
  exceptionResult.facts[3] = { status: "exception", kind: "native-polygon-contact-miss", rowIndex: 23, consumedVisits: 1,
    exception: { name: "RangeError", message: "original polygon predicate", stack: "native stack" } }
  expect(() => assertParallelReferenceContinuityBatchResult(exceptionResult, batch)).not.toThrow()
  const mutations: ((value: any) => void)[] = [
    (value): void => { value.schema = "reference-continuity-facts/v1:ordinal-snapshot-kind-row-value-visits-exception" },
    (value): void => { value.schemaHash = "stale" },
    (value): void => { value.result.facts[3].kind = "native-trace-pair-miss" },
    (value): void => { value.result.facts[3].rowIndex = 22 },
    (value): void => { value.result.facts[3].consumedVisits = 0 },
    (value): void => { value.result.facts[3].consumedVisits = 2 },
    (value): void => { value.result.facts[3].value = 1 },
    (value): void => { value.result.facts[3].status = "unexpected" },
  ]
  for (const mutate of mutations) {
    const malformed = structuredClone(response)
    mutate(malformed)
    expect(() => assertNativeSyncReferenceResponse(malformed, identity, batch)).toThrow()
  }
  let observations = 0
  for (const field of ["name", "message", "stack"]) {
    const malformed = structuredClone(exceptionResult)
    const fact = malformed.facts[3]!
    if (fact.status !== "exception") throw new Error("Expected polygon exception fixture")
    Object.defineProperty(fact.exception, field, { get(): never { observations++; throw new Error("observer") } })
    expect(() => assertParallelReferenceContinuityBatchResult(malformed, batch)).toThrow()
  }
  expect(observations).toBe(0)

  const failed = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    await failed.initializeReferenceTransport()
    await failed.warmup()
    const badContext = prepareParallelReferenceContinuityContext({ snapshotId: 92, portCount: 0, tracePortOrdinals: [], components: [],
      geometryPolygons: [{ faces: [[], captureReferenceDrcPolygonSnapshot(polygons[0]!).faces[0]!] }], geometryTolerance: 0.01 })
    const badBatch: ParallelReferenceContinuityBatch = { kind: "referenceContinuityFacts", context: badContext,
      tasks: Array.from({ length: 4 }, (_, rowIndex): ParallelReferenceContinuityBatch["tasks"][number] => ({
        kind: "native-polygon-contact-miss", rowIndex, leftPolygonIndex: 0, rightPolygonIndex: 0 })) }
    const binding = getNativeSyncReferencePoolBinding(failed)!
    const executor = createNativeSyncReferenceFactExecutor(failed)!
    let failure: unknown
    try { executor(badBatch) } catch (error: unknown) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect(binding.book.stats.batchesCompleted).toBe(0)
    expect(binding.book.stats.workersReserved).toBe(3)
    expect(binding.book.stats.workersRetired).toBe(3)
    expect(binding.book.stats.protocolFailures).toBe(1)
    await expect(failed.run({ kind: "warmup" })).rejects.toBe(failure)
  } finally { failed.dispose() }
})
