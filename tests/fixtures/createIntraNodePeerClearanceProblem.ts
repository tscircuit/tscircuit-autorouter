import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

type PeerRoutesInput = {
  separation: number
  peerCopperDiameter: number
  peerKind: "trace" | "via"
}

type PeerSolverInput = {
  routes: HighDensityIntraNodeRoute[]
  scale?: number
  connMap?: ConnectivityMap
}

export const createIntraNodePeerClearanceRoutes = ({
  separation,
  peerCopperDiameter,
  peerKind,
}: PeerRoutesInput): HighDensityIntraNodeRoute[] => {
  const viaX = 0.125
  const peerX = viaX + separation
  return [
    {
      connectionName: "via-route",
      rootConnectionName: "via-root",
      regionId: "peer-clearance-node",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      startPcbPortId: "via-start",
      endPcbPortId: "via-end",
      route: [
        { x: viaX, y: 0, z: 0, pcb_port_id: "via-start" },
        { x: viaX, y: 0, z: 1, pcb_port_id: "via-end" },
      ],
      vias: [{ x: viaX, y: 0 }],
    },
    {
      connectionName: "peer-route",
      rootConnectionName: "peer-root",
      regionId: "peer-clearance-node",
      traceThickness: peerKind === "trace" ? peerCopperDiameter : 0.15,
      viaDiameter: peerKind === "via" ? peerCopperDiameter : 0.3,
      route:
        peerKind === "trace"
          ? [
              { x: peerX, y: -1, z: 0, traceThickness: peerCopperDiameter },
              { x: peerX, y: 1, z: 0 },
            ]
          : [
              { x: peerX, y: 0, z: 0 },
              { x: peerX, y: 0, z: 1 },
            ],
      vias: peerKind === "via" ? [{ x: peerX, y: 0 }] : [],
    },
  ]
}

export const createIntraNodePeerClearanceSolver = ({
  routes,
  scale,
  connMap,
}: PeerSolverInput): IntraNodeRouteSolver => {
  const connectivityMap =
    connMap ??
    new ConnectivityMap(
      Object.fromEntries(
        routes.map((route): [string, string[]] => [
          route.connectionName,
          [route.connectionName],
        ]),
      ),
    )
  const canonicalNetIdByConnectionName = new Map<string, string>()
  for (const route of routes) {
    const canonicalNetId = connectivityMap.getNetConnectedToId(
      route.connectionName,
    )
    if (canonicalNetId === undefined) {
      throw new Error(`Missing test net for ${route.connectionName}`)
    }
    canonicalNetIdByConnectionName.set(route.connectionName, canonicalNetId)
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "peer-clearance-node",
    center: { x: 0, y: 0 },
    width: 20,
    height: 20,
    availableZ: [0, 1],
    portPoints: routes.flatMap((route): PortPoint[] =>
      [route.route[0]!, route.route.at(-1)!].map(
        (point): PortPoint => ({
          ...point,
          connectionName: route.connectionName,
          rootConnectionName: route.rootConnectionName,
        }),
      ),
    ),
  }
  const index = new FixedCopperClearanceIndex({
    rectangles: [],
    layerCount: 2,
    minClearance: 0.1,
  })
  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints: node,
    connMap: connectivityMap,
    layerCount: 2,
    ...(scale === undefined
      ? {}
      : {
          physicalClearanceContext: {
            traceClearanceIndex: index,
            viaClearanceIndex: index,
            traceToTraceClearance: 0.1,
            viaToTraceClearance: 0.1,
            canonicalNetIdByConnectionName,
            solveToPhysicalTransform: {
              center: { x: 0, y: 0 },
              scale,
            },
          },
        }),
  })
  solver.solvedRoutes = routes
  return solver
}
