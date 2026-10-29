import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getPipeline9PhysicalOwnership,
  type Pipeline9PhysicalOwnership,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { HyperGraphHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { SimpleRouteJson } from "lib/types/srj-types"

type SkinnyViaPadUnionOptions = {
  alternatingOwners?: boolean
  omittedPadIndices?: readonly number[]
  rotation?: 0 | 90
}

type SkinnyViaPadUnionFixture = {
  graph: HyperGraphHg
  originalSrj: SimpleRouteJson
  physicalOwnership: Pipeline9PhysicalOwnership
  routingNetIds: readonly string[]
  viaDiameter: number
}

export const makeSkinnyViaPadUnion = (
  options: SkinnyViaPadUnionOptions = {},
): SkinnyViaPadUnionFixture => {
  const quarterTurn = options.rotation === 90
  const originalSrj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaEdgeToPadEdgeClearance: 0.1,
    minBoardEdgeClearance: 0,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: ["signal", "pad-even", "pad-odd"].map((name) => ({
      name,
      pointsToConnect: [{ x: 4, y: 4, layer: "top", pcb_port_id: `${name}-port` }],
    })),
    obstacles: Array.from({ length: 12 }, (_, index) => index)
      .filter((index) => !options.omittedPadIndices?.includes(index))
      .map((index) => {
        const y = -2.75 + index * 0.5
        const owner = options.alternatingOwners && index % 2 ? "pad-odd" : "pad-even"
        return { type: "rect", center: quarterTurn ? { x: -y, y: 0 } : { x: 0, y },
          width: 0.5, height: 0.4, ccwRotationDegrees: quarterTurn ? 90 : 0,
          layers: [index % 2 ? "bottom" : "top"], connectedTo: [`${owner}-port`] }
      }),
  }
  const graph: HyperGraphHg = { ports: [], regions: [{ regionId: "skinny-union", ports: [],
    d: { capacityMeshNodeId: "skinny-union", center: { x: 0, y: 0 },
      width: quarterTurn ? 6 : 0.5, height: quarterTurn ? 0.5 : 6,
      layer: "inner1", availableZ: [1] } }] }
  const physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj,
    routingConnMap: new ConnectivityMap({
      "routing-signal": ["signal", "signal-port"],
      "routing-even": ["pad-even", "pad-even-port"],
      "routing-odd": ["pad-odd", "pad-odd-port"],
    }) })
  return { graph, originalSrj, physicalOwnership,
    routingNetIds: ["routing-signal", "routing-even", "routing-odd", "unknown"], viaDiameter: 0.3 }
}
