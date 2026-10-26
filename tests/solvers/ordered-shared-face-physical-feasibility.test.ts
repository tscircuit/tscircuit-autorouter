import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import { createPhysicalViaCapacityEvaluator } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createPhysicalViaCapacityEvaluator"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"

type FixtureCase = {
  name: string
  nodes: CapacityMeshNode[]
  ports: {
    portPointId: string
    x: number
    y: number
    z: number
    connectionName: string
    rootConnectionName: string
  }[]
  physicalSrj: SimpleRouteJson
  planningObstacles: Obstacle[]
}

function getQuery(fixture: FixtureCase): {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  regionId: number
  fromPortId: number
  toPortId: number
  routeId: number
  netId: number
  regionSegments: [number, number, number][]
} {
  const { nodes, ports } = fixture
  const portIds = ports.map((_, index) => index)
  return {
    topology: {
      portCount: ports.length,
      regionCount: 2,
      regionIncidentPorts: [portIds, portIds],
      incidentPortRegion: ports.map(() => [0, 1]),
      regionWidth: new Float64Array(nodes.map((node) => node.width)),
      regionHeight: new Float64Array(nodes.map((node) => node.height)),
      regionCenterX: new Float64Array(nodes.map((node) => node.center.x)),
      regionCenterY: new Float64Array(nodes.map((node) => node.center.y)),
      regionAvailableZMask: new Int32Array([255, 255]),
      regionMetadata: nodes,
      portMetadata: ports.map((port) => ({
        serializedPortId: port.portPointId,
      })),
      portAngleForRegion1: new Int32Array(ports.length),
      portAngleForRegion2: new Int32Array(ports.length),
      portX: new Float64Array(ports.map((port) => port.x)),
      portY: new Float64Array(ports.map((port) => port.y)),
      portZ: new Int32Array(ports.map((port) => port.z)),
    },
    problem: {
      routeCount: ports.length,
      portSectionMask: new Int8Array(ports.length).fill(1),
      routeStartPort: new Int32Array(portIds),
      routeEndPort: new Int32Array(portIds),
      routeNet: new Int32Array(portIds),
      regionNetId: new Int32Array([-1, -1]),
      routeMetadata: ports.map((port) => ({
        connectionId: port.connectionName,
        simpleRouteConnection: {
          __rootConnectionNames: [port.rootConnectionName],
        },
      })),
    },
    regionId: 0,
    fromPortId: ports.length - 1,
    toPortId: ports.length - 1,
    routeId: ports.length - 1,
    netId: ports.length - 1,
    regionSegments: portIds.slice(0, -1).map((index) => [index, index, index]),
  }
}

test("actual inherited-order and movable SOIC capacity conflicts expose port-event rerip alternatives", (): void => {
  const { cases } = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/ordered-shared-face-failures.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { cases: FixtureCase[] }
  cases.push({
    name: "empty-existing-domain",
    nodes: [
      {
        capacityMeshNodeId: "left",
        layer: "top",
        center: { x: -0.5, y: 0.5 },
        width: 1,
        height: 1,
        availableZ: [0, 1],
      },
      {
        capacityMeshNodeId: "right",
        layer: "top",
        center: { x: 0.5, y: 0.5 },
        width: 1,
        height: 1,
        availableZ: [0, 1],
      },
    ],
    ports: [
      {
        portPointId: "a",
        x: 0.3,
        y: 0.25,
        z: 0,
        connectionName: "A",
        rootConnectionName: "A-root",
      },
      {
        portPointId: "b",
        x: 0,
        y: 0.75,
        z: 0,
        connectionName: "B",
        rootConnectionName: "B-root",
      },
    ],
    physicalSrj: {
      layerCount: 2,
      minTraceWidth: 0.1,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      connections: [
        { name: "A", __rootConnectionNames: ["A-root"], pointsToConnect: [] },
        { name: "B", __rootConnectionNames: ["B-root"], pointsToConnect: [] },
      ],
      obstacles: [{ type: "rect", center: { x: 0, y: 0.5 }, width: 0.1, height: 2,
        layers: ["top"], connectedTo: ["pcb_smtpad_B", "B"] }],
    },
    planningObstacles: [],
  })
  const immutable = structuredClone(cases)
  for (const fixture of cases) {
    const ids = fixture.nodes.map((node) => node.capacityMeshNodeId)
    const evaluate = createPhysicalViaCapacityEvaluator({
      physicalSrj: fixture.physicalSrj,
      freeRegionIds: [], sharedEdgeRegionIds: ids, movableSharedEdgeRegionIds: ids,
      planningObstacles: fixture.planningObstacles, preserveSolitarySharedEdgePorts: false,
    })!
    const query = getQuery(fixture)
    const result = evaluate(query)
    expect(result.feasible).toBe(false)
    if (result.feasible || !result.alternativeBlockerRouteIdSets)
      throw new Error(`Expected port-event alternatives for ${fixture.name}`)
    expect(result.alternativeBlockerRouteIdSets).toEqual(fixture.ports.length === 2 ? [[0]] : [[1], [0]])
    for (const ids of result.alternativeBlockerRouteIdSets) {
      expect(evaluate({ ...query, ignoredRouteIds: new Set(ids) })).toEqual({ feasible: true })
    }
    if (fixture.name === "inherited-order") {
      const reversed = { ...query.topology, portY: query.topology.portY.slice() }
      reversed.portY.reverse()
      expect(evaluate({ ...query, topology: reversed })).toEqual({ feasible: true })
    }
    const aliasId = fixture.ports.length
    const aliasProblem = {
      ...query.problem,
      routeCount: aliasId + 1,
      routeMetadata: [...query.problem.routeMetadata!, query.problem.routeMetadata![0]],
    }
    const aliased = evaluate({
      ...query,
      problem: aliasProblem,
      regionSegments: [...query.regionSegments, [aliasId, 0, 0]],
    })
    expect(aliased).toEqual({
      feasible: false,
      alternativeBlockerRouteIdSets: fixture.ports.length === 2 ? [[0, aliasId]] : [[1], [0, aliasId]],
    })
    const faceX = fixture.nodes[0]!.center.x + fixture.nodes[0]!.width / 2
    const boundaryObstacle: Obstacle = {
      type: "rect", center: { x: faceX + 1, y: fixture.ports[0]!.y },
      width: 2, height: 2, layers: ["bottom"], connectedTo: [],
    }
    const boundary = createPhysicalViaCapacityEvaluator({
      physicalSrj: fixture.physicalSrj,
      freeRegionIds: [], sharedEdgeRegionIds: ids, movableSharedEdgeRegionIds: ids,
      planningObstacles: [boundaryObstacle], preserveSolitarySharedEdgePorts: true,
    })!
    expect(boundary(query)).toEqual(result)
    expect(boundary({ ...query, regionSegments: [] })).toEqual({ feasible: true })
    if (fixture.name === "empty-existing-domain") {
      expect(boundary({ ...query, routeId: 0, fromPortId: 0, toPortId: 0, regionSegments: [] }))
        .toEqual({ feasible: true })
      const emptyCandidate = {
        ...query, routeId: 0, fromPortId: 0, toPortId: 0,
        regionSegments: [[1, 1, 1]] as [number, number, number][],
      }
      expect(boundary(emptyCandidate)).toEqual({
        feasible: false, alternativeBlockerRouteIdSets: [[1]],
      })
      expect(boundary({ ...emptyCandidate, ignoredRouteIds: new Set([1]) }))
        .toEqual({ feasible: true })
    }
    const anchored = createPhysicalViaCapacityEvaluator({
      physicalSrj: fixture.physicalSrj, freeRegionIds: [], sharedEdgeRegionIds: ids,
      movableSharedEdgeRegionIds: [], planningObstacles: fixture.planningObstacles,
      preserveSolitarySharedEdgePorts: false,
    })!
    expect(anchored(query)).toEqual({ feasible: true })
  }
  expect(cases).toEqual(immutable)
})
