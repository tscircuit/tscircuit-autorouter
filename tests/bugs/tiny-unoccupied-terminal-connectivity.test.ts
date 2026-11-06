import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph"
import {
  buildSerializedTinyGraph,
  getOmittedUnoccupiedPorts,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { preserveSerializedTerminalConnectivity } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/preserveSerializedTerminalConnectivity"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import fixture from "../fixtures/assets/a64-cramped-terminal-connectivity.json"

function reachesGoal(graph: SerializedHyperGraph): boolean {
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const visited = new Set([problem.routeStartPort[0]])
  const queue = [problem.routeStartPort[0]]
  for (let index = 0; index < queue.length; index++) {
    for (const region of topology.incidentPortRegion[queue[index]!]) {
      for (const port of topology.regionIncidentPorts[region!]) {
        if (visited.has(port)) continue
        visited.add(port)
        queue.push(port)
      }
    }
  }
  return visited.has(problem.routeEndPort[0])
}

test("restores existing A64 interfaces without changing owners or virtual terminals", (): void => {
  const srj = fixture.input.simpleRouteJson as SimpleRouteJson
  const segments = fixture.input.sharedEdgeSegments as SharedEdgeSegment[]
  const fixtureBefore = JSON.stringify(fixture)
  const built = buildHyperGraph({
    simpleRouteJsonConnections: srj.connections,
    capacityMeshNodes: fixture.input.capacityMeshNodes as CapacityMeshNode[],
    segmentPortPoints: (fixture.filteredSegments as SharedEdgeSegment[]).flatMap(
      (segment) => segment.portPoints,
    ),
    layerCount: srj.layerCount,
    connectivityMap: getConnectivityMapFromSimpleRouteJson(srj),
  })
  const params = {
    ...built,
    layerCount: srj.layerCount,
    preserveTerminalPcbPortIds: true,
  }
  const original = buildSerializedTinyGraph(params)
  const before = JSON.stringify(original)
  const withCandidates = { ...params, unprunedUnoccupiedSegments: segments }
  const output = buildSerializedTinyGraph(withCandidates)
  const directOutput = preserveSerializedTerminalConnectivity(original, () =>
    getOmittedUnoccupiedPorts(withCandidates, original),
  )

  expect(reachesGoal(original)).toBe(false)
  expect(reachesGoal(output)).toBe(true)
  expect(output.ports.length - original.ports.length).toBe(4)
  expect(output).toEqual(directOutput)
  expect(JSON.stringify(original)).toBe(before)
  expect(JSON.stringify(fixture)).toBe(fixtureBefore)
  expect(directOutput.connections).toBe(original.connections)
  expect(directOutput.solvedRoutes).toBe(original.solvedRoutes)
  for (let index = 0; index < original.regions.length; index++) {
    expect(directOutput.regions[index]!.d).toBe(original.regions[index]!.d)
  }
  expect(output.ports.slice(0, original.ports.length)).toEqual(original.ports)
  for (const port of output.ports.slice(original.ports.length)) {
    const source = segments
      .flatMap((segment) => segment.portPoints)
      .find((point) => port.portId.startsWith(`${point.segmentPortPointId}::`))!
    expect({
      x: port.d.x,
      y: port.d.y,
      z: port.d.z,
      cramped: port.d.cramped,
      penalty: port.d.tinyHypergraphPortPenalty,
    }).toEqual({
      x: source.x,
      y: source.y,
      z: source.availableZ[0],
      cramped: source.cramped,
      penalty: undefined,
    })
  }
  expect(preserveSerializedTerminalConnectivity(original, () => [])).toBe(original)
  expect(
    preserveSerializedTerminalConnectivity(output, () => {
      throw new Error("Healthy graph must not prepare candidates")
    }),
  ).toBe(output)
})
