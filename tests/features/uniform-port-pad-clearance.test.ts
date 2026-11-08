import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { spacePortsAroundRetainedCopper } from "lib/solvers/UniformPortDistributionSolver/spacePortsAroundRetainedCopper"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"
import type { Obstacle } from "lib/types"

test("boundary spacing reserves foreign pad clearance on the pad layer", (): void => {
  const edge: SharedEdge = {
    ownerNodeIds: ["above", "below"],
    ownerPairKey: "above|below",
    orientation: "horizontal",
    x1: 0,
    x2: 0.695,
    y1: 0,
    y2: 0,
    center: { x: 0.3475, y: 0 },
    length: 0.695,
    nodeSideByOwnerId: {},
  }
  const ports: PortPointWithOwnerPair[] = [0.695 / 6, (5 * 0.695) / 6].map(
    (x, i) => ({
      x,
      y: 0,
      z: 0,
      portPointId: `signal${i}`,
      connectionName: `signal${i}`,
      ownerNodeIds: edge.ownerNodeIds,
      ownerPairKey: edge.ownerPairKey,
    }),
  )
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      layers: ["top"],
      center: { x: -0.27, y: -0.32 },
      width: 0.54,
      height: 0.64,
      connectedTo: ["power"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 1.02, y: 0.03 },
      width: 0.65,
      height: 0.18,
      connectedTo: ["other"],
    },
  ]
  const input = {
    edge,
    originalPorts: ports,
    preferredPorts: ports,
    movableIds: new Set(ports.map((port) => port.portPointId!)),
    routes: [],
    traceWidth: 0.1,
    clearance: 0.1,
    connMap: new ConnectivityMap({}),
    obstacles,
    layerCount: 4,
  }
  const before = JSON.stringify(input)
  const output = spacePortsAroundRetainedCopper(input)
  expect(output[0]!.x).toBeCloseTo(0.15, 9)
  expect(output[1]!.x).toBeCloseTo(0.545, 9)
  expect(output[1]!.x - output[0]!.x).toBeGreaterThan(0.2)
  expect(JSON.stringify(input)).toBe(before)
  const bottom = ports.map((port) => ({ ...port, z: 3 }))
  expect(
    spacePortsAroundRetainedCopper({
      ...input,
      originalPorts: bottom,
      preferredPorts: bottom,
    }),
  ).toEqual(bottom)
  const own = ports.map((port, i) => ({
    ...port,
    connectionName: i === 0 ? "power" : "other",
  }))
  expect(
    spacePortsAroundRetainedCopper({
      ...input,
      originalPorts: own,
      preferredPorts: own,
    }),
  ).toEqual(own)
})
