import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPortConflictCsr, type PortConflictTopology } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createPortConflictCsr"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"

function bruteForce(topology: PortConflictTopology, distance: number): number[][] {
  const result: number[][] = []
  for (let a = 0; a < topology.portCount; a++) {
    const neighbors: number[] = []
    for (let b = 0; b < topology.portCount; b++) {
      if (a !== b && topology.portZ[a] === topology.portZ[b] &&
        Math.hypot(topology.portX[a]! - topology.portX[b]!, topology.portY[a]! - topology.portY[b]!) + 1e-9 < distance) neighbors.push(b)
    }
    result.push(neighbors)
  }
  return result
}

function verify(topology: PortConflictTopology, distance: number): number[][] {
  const before = JSON.stringify(topology)
  const graph = createPortConflictCsr(topology, distance)
  const rows = Array.from({ length: topology.portCount }, (_, port) =>
    [...graph.portConflictPortIds.subarray(graph.portConflictOffsets[port]!, graph.portConflictOffsets[port + 1]!)])
  expect(rows).toEqual(bruteForce(topology, distance))
  expect(graph.portConflictOffsets).toBeInstanceOf(Int32Array)
  expect(graph.portConflictPortIds).toBeInstanceOf(Int32Array)
  expect(graph.portConflictOffsets.length).toBe(topology.portCount + 1)
  expect(graph.portConflictOffsets[0]).toBe(0)
  expect(graph.portConflictOffsets[topology.portCount]).toBe(graph.portConflictPortIds.length)
  for (let port = 0; port < rows.length; port++) {
    expect(rows[port]).toEqual([...new Set(rows[port])].sort((a, b) => a - b))
    expect(rows[port]).not.toContain(port)
    for (const other of rows[port]!) expect(rows[other]).toContain(port)
  }
  const repeated = createPortConflictCsr(topology, distance)
  expect(repeated.portConflictOffsets).toEqual(graph.portConflictOffsets)
  expect(repeated.portConflictPortIds).toEqual(graph.portConflictPortIds)
  expect(JSON.stringify(topology)).toBe(before)
  return rows
}

test("loaded port CSR captures the actual 74579 copper conflict, matches brute force, and is attached by the live P9 factory", () => {
  // Six actual mandatory endpoints from the failed 9758 HDR constructor.
  const actual: PortConflictTopology = {
    portCount: 6,
    portX: [279.15379899999994, 279.1554989299999, 279.15379899999994,
      279.1554989299999, 279.15379899999994, 279.1554989299999],
    portY: [122.76059043645483, 122.75039999999998, 122.76059043645483,
      122.75039999999998, 122.76059043645483, 122.75039999999998],
    portZ: [0, 1, 1, 2, 2, 4],
  }
  expect(Math.hypot(actual.portX[1]! - actual.portX[2]!, actual.portY[1]! - actual.portY[2]!)).toBeCloseTo(0.01033125148010244, 14)
  expect(verify(actual, 0.1)).toEqual([[], [2], [1], [4], [3], []])
  expect(verify(actual, 0.2)).toEqual([[], [2], [1], [4], [3], []])
  // The old problem had no conflict relation and could assign both foreign owners.
  const legacyCompatibleOwners = [305, 305, 142, 142, 112, 112]
  expect(legacyCompatibleOwners[1]).not.toBe(legacyCompatibleOwners[2])
  expect(verify({ portCount: 0, portX: [], portY: [], portZ: [] }, 0.2)).toEqual([])
  expect(verify({ portCount: 1, portX: [0], portY: [0], portZ: [0] }, 0.2)).toEqual([[]])
  const boundary = { portCount: 8, portX: [0, 0.2, 0.2 - 0.5e-9, 0.2 - 2e-9, -0.2, -0.2 + 2e-9, 0, 0],
    portY: [0, 0, 0, 0, 0, 0, 0, 0], portZ: [0, 0, 0, 0, 0, 0, 1, 0] }
  const boundaryRows = verify(boundary, 0.2)
  expect(boundaryRows[0]).toEqual([3, 5, 7])
  Object.freeze(boundary.portX); Object.freeze(boundary.portY); Object.freeze(boundary.portZ)
  expect(verify(boundary, 0.2)).toEqual(boundaryRows)
  let seed = 0x74579
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  for (let iteration = 0; iteration < 48; iteration++) {
    const n = 32 + Math.floor(random() * 96), x: number[] = [], y: number[] = [], z: number[] = []
    const origin = iteration % 3 === 0 ? 1e9 : -0.4
    for (let port = 0; port < n; port++) {
      x.push(port % 11 === 0 && port > 0 ? x[port - 1]! : origin + random() * 1.2)
      y.push(port % 11 === 0 && port > 0 ? y[port - 1]! : origin + random() * 1.2)
      z.push(port % 11 === 0 && port > 0 ? z[port - 1]! : Math.floor(random() * 4))
    }
    verify({ portCount: n, portX: Float64Array.from(x), portY: Float64Array.from(y), portZ: Int32Array.from(z) }, [0.1, 0.2, 0.35][iteration % 3]!)
  }
  for (const radius of [0, -1, Infinity, NaN]) expect(() => createPortConflictCsr(actual, radius)).toThrow("Invalid physical")
  expect(() => createPortConflictCsr({ ...actual, portX: [NaN, ...Array(5).fill(0)] }, 0.2)).toThrow("coordinates")
  expect(() => createPortConflictCsr({ ...actual, portZ: [0.5, ...Array(5).fill(0)] }, 0.2)).toThrow("coordinates")
  expect(() => createPortConflictCsr({ ...actual, portCount: 5 }, 0.2)).toThrow("geometry")

  const witness = { portCount: 2, portX: [0, 0.15], portY: [0, 0], portZ: [0, 0] }
  for (const clearance of [undefined, 0, 0.2]) {
    const srj: SimpleRouteJson = { layerCount: 8, minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: clearance, allowBlindAndBuriedVias: false,
      obstacles: [], connections: [], bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 } }
    const pipeline = new Pipeline9(srj)
    pipeline.capacityNodes = []; pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints = []
    pipeline.srjWithPointPairs = srj; pipeline.connMap = new ConnectivityMap({})
    const factory = pipeline.pipelineDef.find((stage) => stage.solverName === "portPointPathingSolver")!
    const [params] = factory.getConstructorParams(pipeline) as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>
    expect(typeof params.createPortConflicts).toBe("function")
    const model = { topology: witness, problem: { routeNet: [] } }
    const graph = params.createPortConflicts!(model)
    expect([...graph.portConflictPortIds]).toEqual(clearance === 0 ? [] : [1, 0])
    // The callback retains a scalar rule and does not depend on the live pipeline.
    pipeline.minTraceWidth = 9
    pipeline.originalSrj = { ...pipeline.originalSrj, minTraceToPadEdgeClearance: 9 }
    expect(params.createPortConflicts!(model)).toEqual(graph)
    let invoked = 0
    const create = params.createPortConflicts!
    params.createPortConflicts = (loaded) => { invoked++; expect(loaded.topology.portCount).toBe(0); return create(loaded) }
    const wrapper = new TinyHypergraphPortPointPathingSolver(params)
    expect(invoked).toBe(0)
    ;(wrapper as any).tinyPipelineSolver.step()
    expect(invoked).toBe(1)
  }
})
