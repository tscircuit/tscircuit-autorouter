import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import captured from "./captured-graph.json"

// Reduced from a Pipeline9 graph capture. Coordinates, port angles, layer masks,
// and fixed copper are preserved; IDs are renamed and coordinates translated.
export function getPreloadedSingleLayerCrossing(): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
} {
  const { topology, problem } = structuredClone(captured)
  return {
    topology: {
      ...topology,
      regionWidth: Float64Array.from(topology.regionWidth),
      regionHeight: Float64Array.from(topology.regionHeight),
      regionCenterX: Float64Array.from(topology.regionCenterX),
      regionCenterY: Float64Array.from(topology.regionCenterY),
      regionAvailableZMask: Int32Array.from(topology.regionAvailableZMask),
      regionViaAreaFraction: Float64Array.from(topology.regionViaAreaFraction),
      portAngleForRegion1: Int32Array.from(topology.portAngleForRegion1),
      portAngleForRegion2: Int32Array.from(topology.portAngleForRegion2),
      portX: Float64Array.from(topology.portX),
      portY: Float64Array.from(topology.portY),
      portZ: Int32Array.from(topology.portZ),
    },
    problem: {
      ...problem,
      portSectionMask: Int8Array.from(problem.portSectionMask),
      routeStartPort: Int32Array.from(problem.routeStartPort),
      routeEndPort: Int32Array.from(problem.routeEndPort),
      routeNet: Int32Array.from(problem.routeNet),
      routeIsFixed: Uint8Array.from(problem.routeIsFixed),
      regionNetId: Int32Array.from(problem.regionNetId),
      portReservationNetId: Int32Array.from(problem.portReservationNetId),
      portPenalty: Float64Array.from(problem.portPenalty),
    },
  }
}
