import type {
  HighDensityForceImproveSolver,
} from "high-density-repair01/lib/HighDensityForceImproveSolver"

type ForceParams = ConstructorParameters<typeof HighDensityForceImproveSolver>[0]
type ForceRoute = ForceParams["hdRoutes"][number]

export function createHighDensityForceImproveRuntimeFixture(): ForceParams {
  const nodes: ForceParams["nodeWithPortPoints"] = []
  for (let index = 0; index < 4; index++) {
    nodes.push({
      capacityMeshNodeId: `force-node-${index}`,
      center: { x: index * 10, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [],
    })
  }
  const makeRoute = (nodeIndex: number, name: string, baseY = 0): ForceRoute => {
    const points: ForceRoute["route"] = []
    for (let index = 0; index < 5; index++) {
      points.push({
        x: nodeIndex * 10 + index - 2,
        y: baseY + (index === 2 ? 0.5 : 0),
        z: 0,
      })
    }
    return {
      regionId: nodes[nodeIndex]!.capacityMeshNodeId,
      connectionName: name,
      rootConnectionName: `force-net-${nodeIndex}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: points,
    }
  }
  const viaRoute = makeRoute(3, "force-primary-3")
  viaRoute.route.splice(3, 0, { ...viaRoute.route[2]!, z: 1 })
  for (let index = 4; index < viaRoute.route.length; index++) {
    viaRoute.route[index]!.z = 1
  }
  viaRoute.vias = [{ x: 30, y: 0.5 }]
  const unassigned = makeRoute(0, "unassigned-route")
  unassigned.regionId = undefined
  for (const point of unassigned.route) point.x += 100
  return {
    nodeWithPortPoints: nodes,
    totalStepsPerNode: 1,
    nodeAssignmentMargin: 0.2,
    colorMap: {
      "force-primary-2": "#4488aa",
      "force-primary-0": "#ff4400",
      "force-primary-1": "#00aa66",
      "force-primary-3": "#cc00cc",
      "unused-color": "#000000",
    },
    // Node consumption follows the first encountered route, not node-array order.
    hdRoutes: [
      makeRoute(2, "force-primary-2"),
      makeRoute(0, "force-primary-0"),
      makeRoute(2, "force-sibling-2", -0.8),
      viaRoute,
      unassigned,
      makeRoute(1, "force-primary-1"),
      makeRoute(0, "force-sibling-0", -0.8),
    ],
  }
}
