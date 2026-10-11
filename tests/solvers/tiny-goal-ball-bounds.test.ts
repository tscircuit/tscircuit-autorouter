import { expect, test } from "bun:test"
import { computeTinyGoalBallBounds } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGoalBallWorkerJobs"
import type { TinyGoalBallGraph, TinyGoalBallGroup } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGoalBallWorkerTypes"

function graphFromEdges(portCount: number, edges: Array<[number, number, number, number]>,
  halfPenalties = new Float64Array(portCount), regionNetIds = new Int32Array([ -1 ])): TinyGoalBallGraph {
  const rows: Array<Array<[number, number, number]>> = Array.from({ length: portCount }, (): Array<[number, number, number]> => [])
  for (const [from, to, cost, region] of edges) {
    rows[from]!.push([to, cost + halfPenalties[from]! + halfPenalties[to]!, region])
    rows[to]!.push([from, cost + halfPenalties[from]! + halfPenalties[to]!, region])
  }
  const portOffsets = new Int32Array(portCount + 1)
  for (let port = 0; port < portCount; port++) portOffsets[port + 1] = portOffsets[port]! + rows[port]!.length
  const flat = rows.flat()
  return { portOffsets, targets: Int32Array.from(flat, (edge): number => edge[0]),
    costs: Float64Array.from(flat, (edge): number => edge[1]),
    edgeRegionIds: Int32Array.from(flat, (edge): number => edge[2]), regionNetIds, halfPenalties }
}

test("capped goal balls use fresh absolute frontiers and preserve directed bounds under net and port restrictions", (): void => {
  const staleGraph = graphFromEdges(5, [[0, 1, 10, 0], [0, 2, 1, 0], [2, 1, 1, 0], [0, 3, 20, 0], [1, 3, 1, 0], [3, 4, 30, 0]])
  const group: TinyGoalBallGroup = { netId: 10, targetPortId: 0, startPortIds: [4], usablePorts: new Int8Array(5).fill(1) }
  const stale = computeTinyGoalBallBounds(staleGraph, group, 4)
  expect(stale.cutoff).toBe(33)
  expect(stale.bounds).toEqual(new Float64Array([0, 2, 1, 3, 33]))
  const chain = graphFromEdges(5, [[0, 1, 1, 0], [1, 2, 1, 0], [2, 3, 1, 0], [3, 4, 1, 0]])
  const clipped = computeTinyGoalBallBounds(chain, group, 3)
  expect(clipped.cutoff).toBe(3)
  expect(clipped.bounds).toEqual(new Float64Array([0, 1, 2, 3, 3]))
  // Zeroing an unknown node would violate consistency at this frontier edge.
  expect(clipped.bounds[2]).toBeGreaterThan(1)
  const stoppedAtStart = computeTinyGoalBallBounds(chain, { ...group, startPortIds: [1] }, 5)
  expect(stoppedAtStart.expandedPortCount).toBe(2)
  expect(stoppedAtStart.bounds).toEqual(new Float64Array([0, 1, 2, 2, 2]))
  let randomState = 81271
  const random = (): number => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    return randomState / 0x100000000
  }
  for (let iteration = 0; iteration < 32; iteration++) {
    const count = 12
    const penalties = Float64Array.from({ length: count }, (): number => Math.floor(random() * 8))
    const edges: Array<[number, number, number, number]> = []
    for (let from = 0; from < count; from++) for (let to = from + 1; to < count; to++) {
      if (random() < 0.25) edges.push([from, to, 0.1 + random() * 5, Math.floor(random() * 3)])
    }
    const graph = graphFromEdges(count, edges, penalties, new Int32Array([-1, 10, 20]))
    for (const netId of [10, 20]) {
      const usablePorts = Int8Array.from({ length: count }, (): number => random() < 0.8 ? 1 : 0)
      usablePorts[0] = 1
      usablePorts[count - 1] = 1
      const restricted = { netId, targetPortId: 0, startPortIds: [count - 1], usablePorts }
      const actual = Array.from({ length: count }, (_, from): number[] =>
        Array.from({ length: count }, (_, to): number => from === to ? 0 : Infinity))
      for (let from = 0; from < count; from++) {
        if (!usablePorts[from]) continue
        for (let edge = graph.portOffsets[from]!; edge < graph.portOffsets[from + 1]!; edge++) {
          const to = graph.targets[edge]!
          const reservation = graph.regionNetIds[graph.edgeRegionIds[edge]!]!
          if (!usablePorts[to] || (reservation !== -1 && reservation !== netId)) continue
          actual[from]![to] = Math.min(actual[from]![to]!,
            graph.costs[edge]! + penalties[to]! - penalties[from]!)
        }
      }
      for (let via = 0; via < count; via++) for (let from = 0; from < count; from++) for (let to = 0; to < count; to++) {
        actual[from]![to] = Math.min(actual[from]![to]!, actual[from]![via]! + actual[via]![to]!)
      }
      for (const capacity of [1, 2, 4, count]) {
        const result = computeTinyGoalBallBounds(graph, restricted, capacity)
        expect(result.expandedPortCount).toBeLessThanOrEqual(capacity)
        expect(result.bounds[0]).toBe(0)
        for (let from = 0; from < count; from++) {
          if (!usablePorts[from]) continue
          expect(result.bounds[from]).toBeGreaterThanOrEqual(0)
          expect(result.bounds[from]).toBeLessThanOrEqual(actual[from]![0]! + 1e-9)
          for (let edge = graph.portOffsets[from]!; edge < graph.portOffsets[from + 1]!; edge++) {
            const to = graph.targets[edge]!
            const reservation = graph.regionNetIds[graph.edgeRegionIds[edge]!]!
            if (!usablePorts[to] || (reservation !== -1 && reservation !== netId)) continue
            const cost = graph.costs[edge]! + penalties[to]! - penalties[from]!
            expect(result.bounds[from]).toBeLessThanOrEqual(cost + result.bounds[to]! + 1e-9)
          }
        }
      }
    }
  }
  expect(() => computeTinyGoalBallBounds(chain, group, 0)).toThrow("search capacity")
  expect(() => computeTinyGoalBallBounds(chain, { ...group, usablePorts: new Int8Array(5) }, 3)).toThrow("target or net")
  chain.costs[0] = -1
  expect(() => computeTinyGoalBallBounds(chain, group, 3)).toThrow("invalid edge")
})
