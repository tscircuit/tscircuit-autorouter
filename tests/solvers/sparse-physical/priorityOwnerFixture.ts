import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type OwnerWitness = {
  route: HighDensityIntraNodeRoute
  ancestors: Array<[number, OwnerWitness]>
}
type OwnerState = {
  ancestors: Array<Set<number>>
  witnesses: Array<OwnerWitness | undefined>
}
type OwnerFixture = {
  solver: PriorityDagIntraNodeSolver
  state: OwnerState
  ancestorRoute: HighDensityIntraNodeRoute
  childRoute: HighDensityIntraNodeRoute
  ancestorTask: number
  childTask: number
}

export function createPriorityOwnerFixture({
  sameOwner,
  allowBlindAndBuriedVias = false,
}: {
  sameOwner: boolean
  allowBlindAndBuriedVias?: boolean
}): OwnerFixture {
  const ancestorRoute: HighDensityIntraNodeRoute = {
    connectionName: "ancestor",
    rootConnectionName: "root",
    regionId: "same-owner-reuse",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ x: 5, y: 5 }],
    route: [
      { x: 2, y: 5, z: 0 },
      { x: 5, y: 5, z: 0 },
      { x: 5, y: 5, z: 1 },
      { x: 8, y: 5, z: 1 },
    ],
  }
  const childRoute: HighDensityIntraNodeRoute = {
    ...ancestorRoute,
    connectionName: "child",
    vias: [{ x: 5, y: 5 }],
    route: [
      { x: 5, y: 5, z: 0 },
      { x: 5, y: 5, z: 1 },
      { x: 8, y: 8, z: 1 },
    ],
  }
  const solver = new PriorityDagIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "same-owner-reuse",
      center: { x: 5, y: 5 },
      width: 10,
      height: 10,
      availableZ: [0, 1, 2, 3],
      portPoints: [ancestorRoute, childRoute].flatMap((route) =>
        [route.route[0]!, route.route.at(-1)!].map((point) => ({
          ...point,
          connectionName: route.connectionName,
          rootConnectionName: route.rootConnectionName,
        })),
      ),
    },
    connMap: new ConnectivityMap(
      sameOwner
        ? { root: ["ancestor", "child"] }
        : { parent: ["ancestor"], child: ["child"] },
    ),
    priorityFamilySize: 6,
    sparsePhysicalSearch: true,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    obstacleMargin: 0.1,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    layerCount: 4,
    allowBlindAndBuriedVias,
    captureSearchDebug: false,
  })
  const tasks = solver["tasks"]
  const ancestorTask = tasks.findIndex(
    (task) => task.connectionName === "ancestor",
  )
  const childTask = tasks.findIndex((task) => task.connectionName === "child")
  if (ancestorTask < 0 || childTask < 0)
    throw new Error("Missing owner fixture tasks")
  const state: OwnerState = {
    ancestors: tasks.map(() => new Set<number>()),
    witnesses: tasks.map(() => undefined),
  }
  const ancestorWitness: OwnerWitness = { route: ancestorRoute, ancestors: [] }
  state.ancestors[childTask].add(ancestorTask)
  state.witnesses[ancestorTask] = ancestorWitness
  state.witnesses[childTask] = {
    route: childRoute,
    ancestors: [[ancestorTask, ancestorWitness]],
  }
  return { solver, state, ancestorRoute, childRoute, ancestorTask, childTask }
}
