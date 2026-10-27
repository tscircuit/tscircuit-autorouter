import type { TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import type { RoutingInput } from "./RouteProposalSolver"

type NumericArray = Int8Array | Int32Array | Float64Array
type PackedRows = { offsets: Int32Array; values: Int32Array }
export type PackedRoutingInput = {
  id: string
  topology: Omit<TinyHyperGraphTopology, "regionIncidentPorts" | "incidentPortRegion"> & {
    regionIncidentPorts: PackedRows
    incidentPortRegion: PackedRows
  }
  problem: RoutingInput["problem"]
  options: RoutingInput["options"]
}

export function copyReadonlyArray<T extends NumericArray>(source: T): T {
  const buffer = typeof SharedArrayBuffer === "undefined"
    ? new ArrayBuffer(source.byteLength)
    : new SharedArrayBuffer(source.byteLength)
  const Constructor = source.constructor as {new (buffer: ArrayBufferLike): T}
  const result = new Constructor(buffer)
  result.set(source)
  return result
}

function packRows(rows: number[][]): PackedRows {
  const offsets = new Int32Array(rows.length + 1)
  for (let i = 0; i < rows.length; i++) offsets[i + 1] = offsets[i]! + rows[i]!.length
  const values = new Int32Array(offsets[rows.length]!)
  for (let i = 0; i < rows.length; i++) values.set(rows[i]!, offsets[i]!)
  return { offsets: copyReadonlyArray(offsets), values: copyReadonlyArray(values) }
}

/** Shared buffers are written only during construction, never during search. */
export function packRoutingInput(input: RoutingInput): PackedRoutingInput {
  const topology = input.topology
  const problem = input.problem
  return {
    // Transport/cache identity only; never used to order or score routing work.
    id: crypto.randomUUID(),
    topology: {
      portCount: topology.portCount,
      regionCount: topology.regionCount,
      regionIncidentPorts: packRows(topology.regionIncidentPorts),
      incidentPortRegion: packRows(topology.incidentPortRegion),
      regionWidth: copyReadonlyArray(topology.regionWidth),
      regionHeight: copyReadonlyArray(topology.regionHeight),
      regionCenterX: copyReadonlyArray(topology.regionCenterX),
      regionCenterY: copyReadonlyArray(topology.regionCenterY),
      regionAvailableZMask: topology.regionAvailableZMask && copyReadonlyArray(topology.regionAvailableZMask),
      portAngleForRegion1: copyReadonlyArray(topology.portAngleForRegion1),
      portAngleForRegion2: topology.portAngleForRegion2 && copyReadonlyArray(topology.portAngleForRegion2),
      portX: copyReadonlyArray(topology.portX),
      portY: copyReadonlyArray(topology.portY),
      portZ: copyReadonlyArray(topology.portZ),
    },
    problem: {
      routeCount: problem.routeCount,
      portSectionMask: copyReadonlyArray(problem.portSectionMask),
      routeStartPort: copyReadonlyArray(problem.routeStartPort),
      routeEndPort: copyReadonlyArray(problem.routeEndPort),
      routeNet: copyReadonlyArray(problem.routeNet),
      regionNetId: copyReadonlyArray(problem.regionNetId),
      portPenalty: problem.portPenalty && copyReadonlyArray(problem.portPenalty),
      // The complete committed occupancy is supplied in each wave's snapshot.
    },
    options: input.options,
  }
}

export function unpackRoutingInput(input: PackedRoutingInput): RoutingInput {
  const unpack = (rows: PackedRows): number[][] => Array.from(
    {length: rows.offsets.length - 1},
    (_, index) => Array.from(rows.values.subarray(rows.offsets[index]!, rows.offsets[index + 1]!)),
  )
  return {
    topology: {...input.topology, regionIncidentPorts: unpack(input.topology.regionIncidentPorts), incidentPortRegion: unpack(input.topology.incidentPortRegion)},
    problem: input.problem,
    options: input.options,
  }
}
