import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { spacePortsAroundRetainedCopper } from "lib/solvers/UniformPortDistributionSolver/spacePortsAroundRetainedCopper"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("mesh edge spacing reserves retained wire clearance without freezing nearby movable copper", (): void => {
  const edge: SharedEdge = {
    ownerNodeIds: ["left", "right"],
    ownerPairKey: "left|right",
    orientation: "vertical",
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 4,
    center: { x: 0, y: 2 },
    length: 4,
    nodeSideByOwnerId: { left: "right", right: "left" },
  }
  const ports: PortPointWithOwnerPair[] = [1.8, 2.2].map((y, i) => ({
    x: 0,
    y,
    z: 0,
    portPointId: `p${i}`,
    connectionName: `new${i}`,
    ownerNodeIds: edge.ownerNodeIds,
    ownerPairKey: edge.ownerPairKey,
  }))
  const route: HighDensityRoute = {
    connectionName: "retained",
    traceThickness: 0.6,
    viaDiameter: 0.45,
    vias: [],
    route: [
      { x: -1, y: 2, z: 0 },
      { x: 1, y: 2, z: 0 },
    ],
  }
  const params = {
    edge,
    originalPorts: ports,
    preferredPorts: ports,
    movableIds: new Set(["p0", "p1"]),
    routes: [route],
    traceWidth: 0.1,
    clearance: 0.1,
    connMap: new ConnectivityMap({}),
  }
  const before = structuredClone({ ports, route })
  const spaced = spacePortsAroundRetainedCopper(params)
  expect(spaced[0]!.y).toBeLessThanOrEqual(1.55)
  expect(spaced[1]!.y).toBeGreaterThanOrEqual(2.45)
  expect(spaced.map((p) => [p.x, p.z])).toEqual([
    [0, 0],
    [0, 0],
  ])
  expect({ ports, route }).toEqual(before)
  const adjacent = {
    ...route,
    route: [
      { x: 0.1, y: 0, z: 0 },
      { x: 0.1, y: 4, z: 0 },
    ],
  }
  expect(
    spacePortsAroundRetainedCopper({ ...params, routes: [adjacent] }),
  ).toEqual(ports)
  const connMap = new ConnectivityMap({ net: ["retained", "new0", "new1"] })
  expect(spacePortsAroundRetainedCopper({ ...params, connMap })).toEqual(ports)
  const aliasedPorts = ports.map((port) => ({
    ...port,
    rootConnectionName: port.connectionName,
    connectionName: `${port.connectionName}_mst0`,
  }))
  expect(
    spacePortsAroundRetainedCopper({
      ...params,
      connMap,
      originalPorts: aliasedPorts,
      preferredPorts: aliasedPorts,
      routes: [
        {
          ...route,
          connectionName: "retained_fixed_0",
          rootConnectionName: "net",
        },
      ],
    }),
  ).toEqual(aliasedPorts)
  const narrowEdge = { ...edge, y1: 1.8, y2: 2.2, length: 0.4 }
  expect(() =>
    spacePortsAroundRetainedCopper({ ...params, edge: narrowEdge }),
  ).toThrow("No clearance interval")
})
