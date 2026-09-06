import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { createSimplificationConnectivityMap } from "lib/solvers/TraceSimplificationSolver/createSimplificationConnectivityMap"
import { createSimplificationRouteIdentities } from "lib/solvers/TraceSimplificationSolver/createSimplificationRouteIdentities"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("private fragment identities cannot alias existing signals or erase sibling copper", (): void => {
  const routes: HighDensityRoute[] = [0, 1, 2, 3].map(
    (index: number): HighDensityRoute => ({
      connectionName: "shared",
      rootConnectionName: "root",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: index, z: 0 },
        { x: 2, y: index, z: 0 },
      ],
      vias: [],
    }),
  )
  const connMap: ConnectivityMap = new ConnectivityMap({
    common: ["shared", "root", "own-pad"],
    old_common: ["old-member"],
    foreign: [
      "shared_simplification_fragment_0",
      "shared_simplification_fragment_0_1",
    ],
  })
  connMap.addConnections([["shared", "old-member"]])
  const declaredNets: ReadonlyMap<string, string> = new Map([
    ["shared", "old_common"],
    ["shared_simplification_fragment_0_3", "foreign"],
  ])
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: 10, y: 10 },
      width: 0.2,
      height: 0.2,
      layers: ["top"],
      connectedTo: ["shared_simplification_fragment_0_2"],
    },
  ]
  const inputSnapshot: HighDensityRoute[] = structuredClone(routes)
  const connectivitySnapshot: Record<string, string[]> = structuredClone(
    connMap.netMap,
  )
  const declaredSnapshot: ReadonlyMap<string, string> = new Map(declaredNets)
  const identities: ReturnType<typeof createSimplificationRouteIdentities> =
    createSimplificationRouteIdentities({
      hdRoutes: routes.slice(0, 3),
      otherHdRoutes: routes.slice(3),
      obstacles,
      connMap: createSimplificationConnectivityMap(connMap, declaredNets),
      netByConnectionName: declaredNets,
      colorMap: { shared: "red" },
    })
  const indexedRoutes: HighDensityRoute[] = [
    ...identities.hdRoutes,
    ...identities.otherHdRoutes,
  ]
  const privateNames: Set<string> = new Set(
    indexedRoutes.map(
      (route: HighDensityRoute): string => route.connectionName,
    ),
  )
  expect(privateNames.size).toBe(4)
  expect(indexedRoutes[0]!.connectionName).toBe(
    "shared_simplification_fragment_0_4",
  )
  for (const route of indexedRoutes) {
    const name: string = route.connectionName
    expect(identities.connectionNameByInternalName.get(name)).toBe("shared")
    expect(route.rootConnectionName).toBe("root")
    expect(identities.connMap.getNetConnectedToId(name)).toBe("common")
    expect(identities.netByConnectionName!.get(name)).toBe("common")
    expect(identities.connMap.areIdsConnected(name, "own-pad")).toBeTrue()
    expect(identities.connMap.areIdsConnected(name, "old-member")).toBeTrue()
    expect(
      identities.connMap.areIdsConnected(
        name,
        "shared_simplification_fragment_0",
      ),
    ).toBeFalse()
    expect(identities.colorMap[name]).toBe("red")
  }
  const index: HighDensityRouteSpatialIndex = new HighDensityRouteSpatialIndex(
    indexedRoutes,
  )
  index.removeRoute(indexedRoutes[0]!.connectionName)
  for (
    let routeIndex: number = 1;
    routeIndex < indexedRoutes.length;
    routeIndex++
  ) {
    const route: HighDensityRoute = indexedRoutes[routeIndex]!
    const matches: ReturnType<
      HighDensityRouteSpatialIndex["getConflictingRoutesNearPoint"]
    > = index.getConflictingRoutesNearPoint({ x: 1, y: routeIndex, z: 0 }, 0.01)
    expect(
      matches.map((match): string => match.conflictingRoute.connectionName),
    ).toContain(route.connectionName)
  }
  expect(routes).toEqual(inputSnapshot)
  expect(connMap.netMap).toEqual(connectivitySnapshot)
  expect(declaredNets).toEqual(declaredSnapshot)

  for (const reversed of [false, true]) {
    const rootOnlyRoutes: HighDensityRoute[] = routes.map(
      (route: HighDensityRoute, routeIndex: number): HighDensityRoute => ({
        ...route,
        connectionName: "unregistered-shared",
        rootConnectionName: routeIndex === 0 ? undefined : "root",
      }),
    )
    if (reversed) rootOnlyRoutes.reverse()
    const rootOnlyMap: ConnectivityMap = new ConnectivityMap({
      common: ["root"],
    })
    const rootIdentities: ReturnType<
      typeof createSimplificationRouteIdentities
    > = createSimplificationRouteIdentities({
      hdRoutes: rootOnlyRoutes,
      otherHdRoutes: [],
      obstacles: [],
      connMap: rootOnlyMap,
      netByConnectionName: undefined,
      colorMap: {},
    })
    for (const route of rootIdentities.hdRoutes) {
      expect(
        rootIdentities.connMap.getNetConnectedToId(route.connectionName),
      ).toBe("common")
    }
    expect(rootOnlyMap.idToNetMap).toEqual({ root: "common" })
  }

  const contradictoryRoutes: HighDensityRoute[] = routes.slice(0, 2).map(
    (route: HighDensityRoute, routeIndex: number): HighDensityRoute => ({
      ...route,
      rootConnectionName: routeIndex === 0 ? "root-a" : "root-b",
    }),
  )
  expect((): void => {
    createSimplificationRouteIdentities({
      hdRoutes: contradictoryRoutes,
      otherHdRoutes: [],
      obstacles: [],
      connMap: new ConnectivityMap({ a: ["root-a"], b: ["root-b"] }),
      netByConnectionName: undefined,
      colorMap: {},
    })
  }).toThrow('connection "shared" has fragments on different nets')

  const unknownNetMap: ConnectivityMap = new ConnectivityMap({
    shared_simplification_connection: ["foreign-id"],
    connectivity_net2: ["second-foreign-id"],
  })
  const unknownIdentities: ReturnType<
    typeof createSimplificationRouteIdentities
  > = createSimplificationRouteIdentities({
    hdRoutes: routes,
    otherHdRoutes: [],
    obstacles: [],
    connMap: unknownNetMap,
    netByConnectionName: undefined,
    colorMap: {},
  })
  for (const route of unknownIdentities.hdRoutes) {
    expect(
      unknownIdentities.connMap.areIdsConnected(route.connectionName, "shared"),
    ).toBeTrue()
    expect(
      unknownIdentities.connMap.areIdsConnected(
        route.connectionName,
        "foreign-id",
      ),
    ).toBeFalse()
  }
  expect(unknownNetMap.idToNetMap).toEqual({
    "foreign-id": "shared_simplification_connection",
    "second-foreign-id": "connectivity_net2",
  })
})
