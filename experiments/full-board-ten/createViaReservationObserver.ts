import assert from "node:assert/strict"
import { createHash } from "node:crypto"

type RuntimeObject = Record<string, any>
const TARGET_NODE_ID = "topology_merge_17108"

const summarize = (serializable: unknown): RuntimeObject => {
  const serialized = JSON.stringify(serializable)
  return { bytes: Buffer.byteLength(serialized), sha256: createHash("sha256").update(serialized).digest("hex") }
}

/** Read the first actual coarse inputs and the selected coarse result. */
export function createViaReservationObserver(): {
  afterPipelineStep: (pipeline: RuntimeObject) => void
  getReport: () => RuntimeObject
} {
  const report: RuntimeObject = { observationErrors: [] }
  let pathing: RuntimeObject | undefined
  const numericContext = (tiny: RuntimeObject): RuntimeObject => {
    const { topology, problem, state } = tiny
    const regionIds = topology.regionMetadata.flatMap((metadata: RuntimeObject, index: number) =>
      metadata?.capacityMeshNodeId === TARGET_NODE_ID ? [index] : [])
    assert.equal(regionIds.length, 1, "Native reservation region must be unique")
    const regionId = regionIds[0]
    const reservationsByRegion = problem.physicalViaReservationsByRegion
    const targetReservations = reservationsByRegion?.[regionId] ?? []
    assert(targetReservations.length <= 16, "Native reservation context exceeded scope")
    const reservationRegions = reservationsByRegion?.filter((entries: unknown[]) => entries?.length > 0) ?? []
    return {
      iterations: tiny.iterations,
      regionId, regionCount: topology.regionCount, routeCount: problem.routeCount,
      reservationsPresent: Array.isArray(reservationsByRegion),
      reservedRegionCount: reservationRegions.length,
      reservationCount: reservationRegions.reduce((count: number, entries: unknown[]) => count + entries.length, 0),
      targetReservations: targetReservations.map((reservation: RuntimeObject) => ({
        ...structuredClone(reservation), numericNet: problem.routeNet[reservation.routeId],
        routeIsFixed: problem.routeIsFixed?.[reservation.routeId] ?? 0,
        metadata: structuredClone(Object.fromEntries(["connectionId", "mutuallyConnectedNetworkId", "preloadedTraceSection"].map((field) => [field, problem.routeMetadata[reservation.routeId][field]]))),
        fromSerializedPortId: topology.portMetadata[reservation.fromPortId].serializedPortId,
        toSerializedPortId: topology.portMetadata[reservation.toPortId].serializedPortId,
      })),
      initialTargetAssignments: structuredClone(problem.initialAssignments.filter((entry: RuntimeObject) => entry.regionId === regionId)),
      targetSegments: structuredClone(state.regionSegments[regionId]),
    }
  }
  const inspect = (pipeline: RuntimeObject): void => {
    let changed = false
    if (pipeline.portPointPathingSolver && !pathing) {
      pathing = pipeline.portPointPathingSolver
      assert.equal(pathing.iterations, 0, "Must capture original coarse constructor before its first step")
      const serialized = pathing.tinyPipelineSolver.inputProblem.serializedHyperGraph
      const targetRegions = serialized.regions.filter((region: RuntimeObject) => region.d?.capacityMeshNodeId === TARGET_NODE_ID)
      assert.equal(targetRegions.length, 1, "Original native region must be unique")
      const target = targetRegions[0]
      const targetReservations = target.d.physicalViaReservations ?? []
      const rawVias = pathing.params.preloadedTraceVias ?? []
      const nativeVias = rawVias.filter((via: RuntimeObject) => via.traceId === "source_net_20_0" && via.routePosition === 55)
      const ownerConnectionIds = new Set(targetReservations.map((reservation: RuntimeObject) => reservation.connectionId))
      changed = true
      report.originalSerialized = {
        capture: "First pathing constructor, before coarse optimization; physical provenance comes from SRJ preload descriptors",
        pathingIterations: pathing.iterations,
        regionCount: serialized.regions.length, portCount: serialized.ports.length, connectionCount: serialized.connections.length,
        rawViaCount: rawVias.length, rawViaSummary: summarize(rawVias), nativeVias: structuredClone(nativeVias),
        reservationCount: serialized.regions.reduce((count: number, region: RuntimeObject) => count + (region.d?.physicalViaReservations?.length ?? 0), 0),
        targetRegionId: target.regionId, targetReservations: structuredClone(targetReservations),
        targetOriginalAssignments: structuredClone(target.assignments),
        ownerConnections: structuredClone(serialized.connections.filter((connection: RuntimeObject) => ownerConnectionIds.has(connection.connectionId))),
      }
    }
    if (pathing && !report.firstNumeric) {
      const tiny = pathing.tinyPipelineSolver.getSolver("solveGraph")
      if (tiny) {
        changed = true
        report.firstNumeric = { capture: "Earliest observed numeric solveGraph state; physical provenance was captured separately at constructor time", ...numericContext(tiny) }
      }
    }
    if (pathing && pipeline.highDensityRouteSolver && !report.selectedNumeric) {
      changed = true
      report.selectedNumeric = numericContext(pathing.getSolvedTinySolver())
    }
    if (changed) assert(Buffer.byteLength(JSON.stringify(report)) <= 65536, "Via reservation observation exceeded 64 KiB")
  }
  return {
    afterPipelineStep(pipeline: RuntimeObject): void {
      if (report.observationErrors.length > 0 || report.selectedNumeric) return
      try { inspect(pipeline) }
      catch (error) { report.observationErrors.push({ message: String(error).slice(0, 2048) }) }
    },
    getReport(): RuntimeObject { return report },
  }
}
