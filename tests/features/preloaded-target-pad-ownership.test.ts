import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { serializePreloadedTraceAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/serializePreloadedTraceAssignments"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/index"

test("preloaded-only target pads retain ownership without freezing movable traces", (): void => {
  const graph: SerializedHyperGraph = { regions: [], ports: [] }
  for (const [index, net] of ["clock", "fixed-power"].entries()) {
    const y = index * 4
    for (const [side, x] of [0, 2, 4].entries()) {
      graph.regions.push({
        regionId: `${net}-${side}`,
        pointIds: [],
        d: {
          center: { x, y },
          width: 2,
          height: 2,
          availableZ: [0],
          _containsObstacle: side !== 1,
          _containsTarget: side !== 1,
          ...(side !== 1 && { _connectedTo: [net] }),
        },
      })
    }
    for (const [position, x] of [1, 3].entries()) {
      const portId = `${net}-crossing-${position}`
      const region1Id = `${net}-${position}`
      const region2Id = `${net}-${position + 1}`
      graph.ports.push({
        portId,
        region1Id,
        region2Id,
        d: {
          x,
          y,
          z: 0,
          _preloadedTracePortAssignments: [
            {
              traceId: `${net}-trace`,
              fixedNetId: net,
              routePosition: position,
              tracePoint: { x, y },
              z: 0,
              ...(index === 1 && { isFixed: true }),
            },
          ],
        },
      })
      for (const region of graph.regions)
        if ([region1Id, region2Id].includes(region.regionId))
          region.pointIds.push(portId)
    }
  }
  graph.regions.push({
    regionId: "unconnected-pad",
    pointIds: [],
    d: {
      center: { x: 8, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0],
      _containsObstacle: true,
      _containsTarget: true,
      _connectedTo: ["unused"],
    },
  })
  const geometry = structuredClone(
    graph.regions.map(({ regionId, d }) => ({ regionId, center: d!.center })),
  )
  expect(serializePreloadedTraceAssignments(graph)).toEqual({
    preloadedTraceCount: 2,
    preloadedPortCount: 4,
    preloadedAssignmentCount: 2,
  })
  expect(graph.connections).toHaveLength(2)
  expect(graph.connections![0]!).not.toHaveProperty("isFixed", true)
  expect(graph.connections![1]!).toMatchObject({ isFixed: true })
  const loaded = loadSerializedHyperGraph(graph)
  expect([...loaded.problem.routeNet]).toEqual([0, 1])
  expect([...loaded.problem.routeIsFixed!]).toEqual([0, 1])
  expect(loaded.problem.initialAssignments).toHaveLength(2)
  expect(loaded.problem.regionNetId).toHaveLength(6)
  for (const [index, net] of ["clock", "fixed-power"].entries()) {
    for (const side of [0, 2]) {
      const pad = graph.regions.find(
        (region) => region.regionId === `${net}-${side}`,
      )!
      expect(pad.d!.netId).toBe(loaded.problem.routeNet[index])
    }
  }
  expect(
    graph.regions.map(({ regionId, d }) => ({ regionId, center: d!.center })),
  ).toEqual(geometry)
})
