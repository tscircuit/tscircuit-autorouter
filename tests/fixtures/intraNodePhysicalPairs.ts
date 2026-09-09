import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import {
  type IntraNodePhysicalClearanceContext,
  IntraNodeRouteSolver,
} from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

type PhysicalPairProblem = {
  node: NodeWithPortPoints
  pairs: [PortPoint, PortPoint][]
  context: IntraNodePhysicalClearanceContext
  params: ConstructorParameters<typeof IntraNodeRouteSolver>[0]
}

export function createIntraNodePhysicalPairProblem(): PhysicalPairProblem {
  const pairs: [PortPoint, PortPoint][] = [
    [
      {
        x: -1,
        y: 0,
        z: 0,
        connectionName: "paired-net",
        rootConnectionName: "paired-root",
        portPointId: "top-a",
        pcb_port_id: "pcb-top-a",
        nextPortPointId: "top-b",
      },
      {
        x: 1,
        y: 0,
        z: 0,
        connectionName: "paired-net",
        rootConnectionName: "paired-root",
        portPointId: "top-b",
        pcb_port_id: "pcb-top-b",
        prevPortPointId: "top-a",
      },
    ],
    [
      {
        x: 0,
        y: -1,
        z: 1,
        connectionName: "paired-net",
        rootConnectionName: "paired-root",
        portPointId: "bottom-a",
        pcb_port_id: "pcb-bottom-a",
        nextPortPointId: "bottom-b",
      },
      {
        x: 0,
        y: 1,
        z: 1,
        connectionName: "paired-net",
        rootConnectionName: "paired-root",
        portPointId: "bottom-b",
        pcb_port_id: "pcb-bottom-b",
        prevPortPointId: "bottom-a",
      },
    ],
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "physical-pair-node",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: pairs.flatMap((pair): PortPoint[] => structuredClone(pair)),
    portPointsInPairs: structuredClone(pairs),
  }
  const connMap = new ConnectivityMap({
    "paired-root": ["paired-net", "paired-root"],
  })
  const canonicalNetId = connMap.getNetConnectedToId("paired-net")
  if (canonicalNetId === undefined) {
    throw new Error("Physical pair fixture requires its canonical net")
  }
  const index = new FixedCopperClearanceIndex({
    rectangles: [],
    layerCount: 2,
    minClearance: 0.1,
  })
  const context: IntraNodePhysicalClearanceContext = {
    traceClearanceIndex: index,
    viaClearanceIndex: index,
    traceToTraceClearance: 0.1,
    viaToTraceClearance: 0.1,
    canonicalNetIdByConnectionName: new Map([
      ["paired-net", canonicalNetId],
      ["paired-root", canonicalNetId],
    ]),
    solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 1 },
  }
  return {
    node,
    pairs,
    context,
    params: {
      nodeWithPortPoints: node,
      physicalClearanceContext: context,
      layerCount: 2,
      traceWidth: 0.15,
      viaDiameter: 0.3,
      connMap,
    },
  }
}
