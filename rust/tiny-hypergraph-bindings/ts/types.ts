import type * as bindings from "../pkg/tiny_hypergraph_bindings.js"

export type IntegerArray = readonly number[] | Int32Array
export type FloatArray = readonly number[] | Float64Array
export type SectionMask = IntegerArray | Int8Array

export interface TinyHyperGraphTopology {
  portCount: number
  regionCount: number
  regionIncidentPorts: readonly (readonly number[])[]
  incidentPortRegion: readonly (readonly number[])[]
  regionWidth: FloatArray
  regionHeight: FloatArray
  regionCenterX: FloatArray
  regionCenterY: FloatArray
  regionAvailableZMask?: IntegerArray
  regionMetadata?: readonly unknown[]
  portAngleForRegion1: IntegerArray
  portAngleForRegion2?: IntegerArray
  portX: FloatArray
  portY: FloatArray
  portZ: IntegerArray
  portMetadata?: readonly unknown[]
}

export type TinyHyperGraphInitialAssignment =
  bindings.TinyHyperGraphInitialAssignment

export interface TinyHyperGraphProblem {
  routeCount: number
  portSectionMask: SectionMask
  routeMetadata?: readonly unknown[]
  routeStartPort: IntegerArray
  routeEndPort: IntegerArray
  routeNet: IntegerArray
  regionNetId: IntegerArray
  portPenalty?: FloatArray
  initialAssignments?: readonly TinyHyperGraphInitialAssignment[]
}

export type TinyHyperGraphStatus = bindings.SolverStatus

export interface TinyHyperGraphSolution {
  solvedRoutePathSegments: [fromPortId: number, toPortId: number][][]
  solvedRoutePathRegionIds?: (number | undefined)[][]
}

export interface LoadedHyperGraph {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  solution: TinyHyperGraphSolution
}

export interface TinyHyperGraphRoutingSnapshot {
  portAssignment: number[]
  regionSegments: [routeId: number, fromPortId: number, toPortId: number][][]
  currentRouteId: number | undefined
  unroutedRoutes: number[]
}

export type TinyHyperGraphStats = Record<string, unknown>

export type TinyHyperGraphSolverOptions = {
  [K in keyof bindings.TinyHyperGraphSolverOptions]?: NonNullable<
    bindings.TinyHyperGraphSolverOptions[K]
  >
}

export type TinyHyperGraphSolverConfiguration = bindings.SolverConfiguration
