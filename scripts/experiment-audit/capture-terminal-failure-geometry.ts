import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

const own = (value: any, key: string): any => value && (typeof value === "object" || typeof value === "function")
  ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined
const at = (value: any, path: string): any => path.split(".").reduce((object, key) => own(object, key), value)
const ownArray = (value: any, maximum = 4096): any[] => Array.isArray(value) ? Array.from({ length: Math.min(own(value, "length"), maximum) }, (_, index) => own(value, String(index))) : []
const finite = (value: any): value is number => typeof value === "number" && Number.isFinite(value)
const copy = (object: any, keys: string[]) => Object.fromEntries(keys.flatMap((key) => {
  const value = own(object, key)
  if (value === null || finite(value) || typeof value === "boolean") return [[key, value]]
  if (typeof value === "string") return [[key, value.slice(0, 384)]]
  if (Array.isArray(value)) return [[key, ownArray(value, 16).filter((entry) => typeof entry === "string").map((entry) => entry.slice(0, 384))], [`${key}OriginalCount`, own(value, "length")], [`${key}Truncated`, own(value, "length") > 16]]
  return []
}))

const STORES = [
  "physicalNetForestSolver.branches",
  "highDensityStitchSolver.mergedHdRoutes",
  "traceSimplificationSolver.simplifiedHdRoutes",
  "traceWidthSolver.hdRoutesWithWidths",
  "pipeline9JointDrcRepairSolver.inputNewHdRoutes",
  "pipeline9JointDrcRepairSolver.combinedOutput",
  "pipeline9JointDrcRepairSolver.params.updatedPreloadedTraces",
  "effortCleanupSolver.bestRoutes",
  "lengthMatchingPostProcessingSolver.outputHdRoutes",
  "powerTraceExpansionSolver.inputSrj.traces",
  "powerTraceExpansionSolver.inputSrj.fixedTraces",
  "powerTraceExpansionSolver.powerTraceExpanderSolver.traces",
  "powerTraceExpansionSolver.powerTraceExpanderSolver.lastConnectivitySafeTraces",
]
const POINT_KEYS = ["route_type", "x", "y", "z", "layer", "layers", "width", "from_layer", "to_layer", "via_diameter", "via_hole_diameter", "hole_diameter", "drill_diameter", "traceThickness", "pcb_port_id", "pointId", "start_pcb_port_id", "end_pcb_port_id", "toNextSegmentType"]
const TRACE_KEYS = ["type", "pcb_trace_id", "connection_name", "connectionName", "rootConnectionName", "traceThickness", "viaDiameter", "viaHoleDiameter", "connectsTo", "source_trace_id", "__replaces_pcb_trace_id", "startPcbPortId", "endPcbPortId"]

/** Reporting-only capture. Never reconstruct, validate, call a getter or mutate a route. */
export function captureTerminalFailureGeometry(solver: any, original: any, outputDirectory: string, metadata: Record<string, unknown>) {
  const result: any = { schemaVersion: 1, metadata, qualification: "BOUNDED_STORED_STATE_AFTER_SOLVE_FAILURE",
    interpretation: "Stored arrays read at terminal failure, not preserved earlier-phase snapshots. No output getter, reconstruction, connectivity union or checker ran. Proximity selects diagnostic context only and gives no electrical permission.",
    error: null, stores: [], target: null,
    bounds: { bytes: 131072, routePointsScanned: 65536, tracesScannedPerStore: 4096, tracesPerStore: 8, verticesPerSelectedRoute: 12 },
    truncated: false, errors: [] }
  try {
    const rawError = own(solver, "error")
    result.error = typeof rawError === "string" ? rawError.slice(0, 2048) : null
    const match = (result.error ?? "").match(/terminal "([^"]+)"/)
    const port = match?.[1]
    const connections = own(original, "connections")
    if (port && Array.isArray(connections)) {
      for (const connection of ownArray(connections)) {
        const points = own(connection, "pointsToConnect")
        if (!Array.isArray(points)) continue
        for (const point of ownArray(points)) {
          if (own(point, "pcb_port_id") !== port && own(point, "pointId") !== port) continue
          if (finite(own(point, "x")) && finite(own(point, "y"))) {
            result.target = { port, connection: copy(connection, ["name", "source_trace_id", "__netConnectionName", "__rootConnectionNames"]),
              point: copy(point, ["x", "y", "z", "layer", "layers", "pointId", "pcb_port_id"]), originalObstacles: [] }
          }
        }
      }
    }
    if (result.target) {
      for (const obstacle of ownArray(own(original, "obstacles"))) {
        const connected = own(obstacle, "connectedTo")
        if (!(Array.isArray(connected) && ownArray(connected).includes(port)) && own(own(obstacle, "circuitJsonMetadata"), "pcb_port_id") !== port) continue
        if (result.target.originalObstacles.length >= 8) { result.truncated = true; break }
        result.target.originalObstacles.push({ selectedByExactPortReference: true, ...copy(obstacle, ["type", "width", "height", "radius", "layers", "connectedTo", "rotation", "ccwRotationDegrees", "obstacleId"]),
          center: copy(own(obstacle, "center"), ["x", "y"]), circuitJsonMetadata: copy(own(obstacle, "circuitJsonMetadata"), ["pcb_port_id", "pcb_smtpad_id", "pcb_component_id"]) })
      }
    }
    let scanned = 0
    const target = result.target?.point
    for (const path of STORES) {
      const traces = at(solver, path)
      const phase = own(solver, path.split(".")[0])
      const completedPhase = own(phase, "solved") === true
      const row: any = { path, phaseSolved: completedPhase, phaseFailed: own(phase, "failed") === true, available: Array.isArray(traces), storedTraceCount: Array.isArray(traces) ? traces.length : null, selected: [], scanTruncated: false }
      result.stores.push(row)
      if (!Array.isArray(traces) || !target || !completedPhase) continue
      for (let index = 0; index < Math.min(traces.length, 4096); index++) {
        const trace = own(traces, String(index))
        const route = own(trace, "route")
        if (!Array.isArray(route)) continue
        let nearest = -1
        let nearestDistance = Infinity
        for (let n = 0; n < route.length; n++) {
          if (++scanned > 65536) { row.scanTruncated = true; result.truncated = true; break }
          const point = own(route, String(n))
          const x = own(point, "x"), y = own(point, "y")
          if (!finite(x) || !finite(y)) continue
          const distance = Math.hypot(x - target.x, y - target.y)
          if (distance < nearestDistance) { nearest = n; nearestDistance = distance }
        }
        const refs = own(trace, "connectsTo")
        const exactPortReference = Array.isArray(refs) && ownArray(refs).includes(port)
        if (nearest >= 0 && (nearestDistance <= 2 || exactPortReference)) {
          if (row.selected.length >= 8) { row.scanTruncated = true; result.truncated = true; break }
          const start = Math.max(0, nearest - 5), end = Math.min(route.length, start + 12)
          row.selected.push({ traceIndex: index, header: copy(trace, TRACE_KEYS), routePointCount: route.length,
            nearestVertexIndex: nearest, nearestVertexDistanceMm: nearestDistance, exactPortReference,
            originalVertexRange: [start, end], routeWindow: Array.from({ length: end - start }, (_, n) => copy(own(route, String(start + n)), POINT_KEYS)) })
        }
        if (row.scanTruncated) break
      }
      if (traces.length > 4096) { row.scanTruncated = true; result.truncated = true }
    }
    result.routePointsScanned = Math.min(scanned, 65536)
    // The bounded geometry file is separate from the4096-byte lifecycle rows.
    let text = JSON.stringify(result)
    while (Buffer.byteLength(text) > 131072) {
      const largest = [...result.stores].sort((a: any, b: any) => b.selected.length - a.selected.length)[0]
      if (!largest?.selected.length) throw new Error("Failure context metadata exceeds byte limit")
      largest.selected.pop(); result.truncated = true; text = JSON.stringify(result)
    }
    writeFileSync(resolve(outputDirectory, "terminal-failure-geometry.json"), text)
  } catch (error) { result.errors.push(String(error).slice(0, 384)) }
  return { qualification: result.qualification, targetPort: result.target?.port ?? null,
    availableStoreCount: result.stores.filter((row: any) => row.available).length,
    capturedTraceCount: result.stores.reduce((total: number, row: any) => total + row.selected.length, 0),
    truncated: result.truncated, errors: result.errors }
}
