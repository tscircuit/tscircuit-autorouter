import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"
import type { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  SimpleRouteJson,
} from "lib/types"
import { createNetAwareCrampedCorridor } from "./netAwareCrampedPortSites"

type AvailableInput = ConstructorParameters<
  typeof AvailableSegmentPointSolver
>[0]
type ConnectionPoint =
  SimpleRouteJson["connections"][number]["pointsToConnect"][number]
export type AvailableNetAwareCrampedFixture = {
  input: AvailableInput & {
    physicalCrampedPortContext: NonNullable<
      AvailableInput["physicalCrampedPortContext"]
    >
  }
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  canonicalRouteNetId: string
}

export function createAvailableNetAwareCrampedPorts(): AvailableNetAwareCrampedFixture {
  const geometry = createNetAwareCrampedCorridor()
  const definitions = [
    { id: "route-start", x: 0, y: 0, net: "route-net", port: "route-a" },
    { id: "gap-left", x: 0, y: 0.5 },
    { id: "gap-mid", x: 0.5, y: 0.5 },
    { id: "gap-right", x: 0.5, y: 1 },
    { id: "route-end", x: 1, y: 1, net: "route-net", port: "route-b" },
    { id: "upper-start", x: 0, y: 1, net: "upper-net", port: "upper-a" },
    { id: "upper-end", x: -0.5, y: 1, net: "upper-net", port: "upper-b" },
    { id: "right-start", x: 1, y: 0, net: "right-net", port: "right-a" },
    { id: "right-end", x: 1, y: -0.5, net: "right-net", port: "right-b" },
  ]
  const nodes: CapacityMeshNode[] = definitions.map(
    (node): CapacityMeshNode => ({
      capacityMeshNodeId: node.id,
      center: { x: node.x, y: node.y },
      width: 0.5,
      height: 0.5,
      layer: "z0,1",
      availableZ: [0, 1],
      _isComponentTopologyNode: true,
      ...(node.net === undefined
        ? {}
        : {
            _containsTarget: true,
            _targetConnectionName: node.net,
            _connectedTo: [node.net, node.port!],
          }),
    }),
  )
  const edges: CapacityMeshEdge[] = [
    { capacityMeshEdgeId: "route-entry", nodeIds: ["route-start", "gap-left"] },
    { capacityMeshEdgeId: "left-turn", nodeIds: ["gap-left", "gap-mid"] },
    { capacityMeshEdgeId: "upper-turn", nodeIds: ["gap-mid", "gap-right"] },
    { capacityMeshEdgeId: "route-exit", nodeIds: ["gap-right", "route-end"] },
    { capacityMeshEdgeId: "upper-entry", nodeIds: ["upper-start", "upper-end"] },
    { capacityMeshEdgeId: "right-entry", nodeIds: ["right-start", "right-end"] },
  ]
  const connMap = new ConnectivityMap({
    "route-net": ["route-net", "route-a", "route-b"],
    "upper-net": ["upper-net", "upper-a", "upper-b"],
    "right-net": ["right-net", "right-a", "right-b"],
  })
  const netIds = new Map<string, string>()
  for (const name of geometry.routableNetIds) {
    const canonical = connMap.getNetConnectedToId(name)
    if (canonical === undefined) {
      throw new Error(`Available fixture requires canonical net "${name}"`)
    }
    netIds.set(name, canonical)
  }
  const rectangles: FixedCopperRectangle[] = geometry.rectangles.map(
    (rectangle): FixedCopperRectangle => ({
      ...rectangle,
      ownerNetIds: new Set(
        [...rectangle.ownerNetIds].map((name): string => netIds.get(name)!),
      ),
    }),
  )
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: geometry.traceWidth,
    minTraceToPadEdgeClearance: geometry.padGap,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: geometry.rectangles.map(
      (rectangle, index): SimpleRouteJson["obstacles"][number] => ({
        obstacleId: `pad-${index}`,
        type: "rect",
        center: { ...rectangle.center },
        width: rectangle.width,
        height: rectangle.height,
        layers: ["top"],
        connectedTo: [...rectangle.ownerNetIds],
      }),
    ),
    connections: [...geometry.routableNetIds].map(
      (name): SimpleRouteJson["connections"][number] => ({
        name,
        pointsToConnect: definitions
          .filter((node): boolean => node.net === name)
          .map((node): ConnectionPoint => ({
            x: node.x,
            y: node.y,
            layer: "top",
            pcb_port_id: node.port!,
          })),
      }),
    ),
  }
  return {
    input: {
      nodes,
      edges,
      traceWidth: geometry.traceWidth,
      shouldReturnCrampedPortPoints: true,
      physicalCrampedPortContext: {
        rectangles,
        clearanceIndex: new FixedCopperClearanceIndex({
          rectangles,
          layerCount: geometry.layerCount,
          minClearance: geometry.padGap,
        }),
        layerCount: geometry.layerCount,
        traceWidth: geometry.traceWidth,
        traceGap: geometry.traceGap,
        padGap: geometry.padGap,
        routableNetIds: new Set(netIds.values()),
      },
    },
    srj,
    connMap,
    canonicalRouteNetId: netIds.get("route-net")!,
  }
}
