import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
const bugReport = JSON.parse(
  gunzipSync(
    Uint8Array.from(
      readFileSync(
        new URL("./assets/bugreport107-board-1730.json.gz", import.meta.url),
      ),
    ),
  ).toString("utf8"),
) as { simple_route_json: SimpleRouteJson }

test("bugreport107 preserves its preloaded endpoint escape and completes pathing", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(bugReport.simple_route_json),
    { cacheProvider: null },
  )
  while (
    !solver.solved &&
    !solver.failed &&
    solver.getCurrentPhase() !== "portPointPathingSolver"
  ) {
    solver.step()
  }

  expect(solver.failed).toBeFalse()
  const ports = solver.sharedEdgeSegmentsWithNecessaryCrampedPortPoints!.flatMap(
    (segment) => segment.portPoints,
  )
  const endpointExit = ports.find(
    (port) => port.segmentPortPointId === "ce20829_pp0_z0_cramped",
  )
  expect(endpointExit).toBeDefined()
  expect(endpointExit?.cramped).toBeTrue()
  expect(endpointExit?.tinyHypergraphPortPenalty).toBe(1000)
  expect(
    endpointExit?._preloadedTracePortAssignments?.some(
      (assignment) =>
        assignment.traceId === "source_trace_64__source_net_64_mst109_0" &&
        assignment.z === 0,
    ),
  ).toBeTrue()

  // This assertion checks topological reachability. Retaining a cramped
  // crossing does not waive trace-width or clearance checks downstream.
  // Do not count a path through the adjacent foreign-net pad as an escape.
  const freeTopLayerNodes = new Set(
    solver.capacityNodes!
      .filter((node) => !node._containsObstacle && node.availableZ.includes(0))
      .map((node) => node.capacityMeshNodeId),
  )
  const neighborsByNode = new Map<string, Set<string>>()
  for (const port of ports) {
    if (!port.availableZ.includes(0)) continue
    const [left, right] = port.nodeIds
    if (!freeTopLayerNodes.has(left) || !freeTopLayerNodes.has(right)) continue
    if (!neighborsByNode.has(left)) neighborsByNode.set(left, new Set())
    if (!neighborsByNode.has(right)) neighborsByNode.set(right, new Set())
    neighborsByNode.get(left)!.add(right)
    neighborsByNode.get(right)!.add(left)
  }

  const startNode = "new-cmn_471-1401__sub_8_0"
  const endpointNode = "new-cmn_471-1401__sub_4_0"
  expect(freeTopLayerNodes.has(startNode)).toBeTrue()
  expect(freeTopLayerNodes.has(endpointNode)).toBeTrue()
  const reachableNodes = new Set([startNode])
  const pendingNodes = [startNode]
  while (pendingNodes.length > 0) {
    const currentNode = pendingNodes.pop()!
    const neighbors = neighborsByNode.get(currentNode)
    if (!neighbors) continue
    for (const neighbor of neighbors) {
      if (reachableNodes.has(neighbor)) continue
      reachableNodes.add(neighbor)
      pendingNodes.push(neighbor)
    }
  }
  expect(reachableNodes.has(endpointNode)).toBeTrue()

  while (
    !solver.solved &&
    !solver.failed &&
    solver.getCurrentPhase() !== "uniformPortDistributionSolver"
  ) {
    solver.step()
  }
  expect(solver.failed).toBeFalse()
  expect(solver.portPointPathingSolver?.solved).toBeTrue()
  expect(solver.getCurrentPhase()).toBe("uniformPortDistributionSolver")
})
