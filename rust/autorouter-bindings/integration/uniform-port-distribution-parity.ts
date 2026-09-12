import assert from "node:assert/strict"
import fixture from "../../../fixtures/features/uniform-port-distribution-path-ordering-issue-repro.json"
import { UniformPortDistributionSolver, type UniformPortDistributionSolverInput } from "../../../lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { importReference } from "./tsReference"
import { getSharedEdgeForNodePair } from "../../../lib/solvers/UniformPortDistributionSolver/getSharedEdgeForNodePair"
import { getOwnerPairKey, normalizeOwnerPair } from "../../../lib/solvers/UniformPortDistributionSolver/getOwnerPairKey"
import { precomputeSharedEdges } from "../../../lib/solvers/UniformPortDistributionSolver/precomputeSharedEdges"

const { UniformPortDistributionSolver: Reference } = await importReference<typeof import("../../../lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver")>("lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver.ts")

function snapshot(solver: UniformPortDistributionSolver): unknown {
  return {
    bounds: [...solver.mapOfNodeIdToBounds],
    families: [...solver.mapOfOwnerPairToPortPoints],
    edges: [...solver.mapOfOwnerPairToSharedEdge],
    queue: [...solver.ownerPairsToProcess],
    current: solver.currentOwnerPairBeingProcessed,
    output: solver.getOutput(),
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    progress: solver.progress,
  }
}

function compare(input: UniformPortDistributionSolverInput): void {
  const original = structuredClone(input)
  const nativeInput = structuredClone(input)
  const expected = new Reference(original)
  const actual = new UniformPortDistributionSolver(nativeInput)
  assert.deepEqual(snapshot(actual), snapshot(expected))
  while (!expected.solved) {
    expected.step()
    actual.step()
    assert.deepEqual(snapshot(actual), snapshot(expected))
  }
  const firstOutput = actual.getOutput()
  // This solver overrides step directly: even a solved solver rebuilds output.
  expected.step()
  actual.step()
  assert.notEqual(actual.getOutput(), firstOutput)
  assert.equal(actual.iterations, 0)
  assert.deepEqual(snapshot(actual), snapshot(expected))
  assert.deepEqual(nativeInput, original)
}

compare(fixture as UniformPortDistributionSolverInput)

for (const names of [["left", "right"], ["__proto__", "constructor"], ["\u{10000}", "\ue000"], ["\ud800", "\ud801"], ["\udfff", "\ufffd"], ["1", "0"]]) {
  const [left, right] = names as [string, string]
  const port = { portPointId: "shared", connectionName: "net", x: 0, y: -0.2, z: 0 }
  const nodes = [
    { capacityMeshNodeId: left, center: { x: -1, y: 0 }, width: 2, height: 4, portPoints: [port], availableZ: [0] },
    { capacityMeshNodeId: right, center: { x: 1, y: 0 }, width: 2, height: 4, portPoints: [port], availableZ: [0] },
  ]
  compare({
    nodeWithPortPoints: nodes,
    inputNodesWithPortPoints: nodes.map(node => ({ ...node, portPoints: [{ ...port, connectionNodeIds: [right, left] }] })),
    obstacles: [],
  } as UniformPortDistributionSolverInput)
}

const referenceEdge = await importReference<typeof import("../../../lib/solvers/UniformPortDistributionSolver/getSharedEdgeForNodePair")>("lib/solvers/UniformPortDistributionSolver/getSharedEdgeForNodePair.ts")
const referencePair = await importReference<typeof import("../../../lib/solvers/UniformPortDistributionSolver/getOwnerPairKey")>("lib/solvers/UniformPortDistributionSolver/getOwnerPairKey.ts")
const referenceEdges = await importReference<typeof import("../../../lib/solvers/UniformPortDistributionSolver/precomputeSharedEdges")>("lib/solvers/UniformPortDistributionSolver/precomputeSharedEdges.ts")
for (const a of ["a", "__proto__", "\ud800", "\udfff", "\u{10000}", "", "a|b"]) {
  for (const b of ["b", "constructor", "\ud801", "\ufffd", "\ue000", "", "b|c"]) {
    assert.deepEqual(normalizeOwnerPair(a, b), referencePair.normalizeOwnerPair(a, b))
    assert.equal(getOwnerPairKey([a, b]), referencePair.getOwnerPairKey([a, b]))
    for (const boundary of [0, -0, 0.1, 1e-7, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const nodeBounds = new Map([
        [a, { minX: -1, maxX: boundary, minY: -1, maxY: 1 }],
        [b, { minX: boundary, maxX: 1, minY: -0, maxY: 2 }],
      ])
      const params = { nodeAId: a, nodeBId: b, nodeBounds }
      assert.deepEqual(getSharedEdgeForNodePair(params), referenceEdge.getSharedEdgeForNodePair(params))
      const pairs = { ownerPairs: [[a, b], [b, a], [a, a]] as [string, string][], nodeBounds }
      assert.deepEqual(precomputeSharedEdges(pairs), referenceEdges.precomputeSharedEdges(pairs))
    }
  }
}

function aliases(Solver: typeof Reference): unknown {
  const metadata = { labels: ["original"] }
  const symbol = Symbol.for("uniform-port-metadata")
  const tracked = { portPointId: "p", connectionName: "net", x: 0, y: 0, z: 0, metadata, [symbol]: metadata }
  const untracked = { connectionName: "net", x: -1, y: 0, z: 0, metadata }
  const node = { capacityMeshNodeId: "a", center: { x: -1, y: 0 }, width: 2, height: 2, availableZ: [0], portPoints: [tracked, untracked], portPointsInPairs: [[tracked, untracked]] }
  const neighbor = { ...node, capacityMeshNodeId: "b", center: { x: 1, y: 0 }, portPoints: [tracked] }
  const input = {
    nodeWithPortPoints: [node, neighbor],
    inputNodesWithPortPoints: [node, neighbor].map(value => ({ ...value, portPoints: [{ ...tracked, connectionNodeIds: ["b", "a"] }] })),
    obstacles: [],
  } as unknown as UniformPortDistributionSolverInput
  const solver = new Solver(input)
  const family = solver.mapOfOwnerPairToPortPoints.get("a|b")!
  const familyPoint = family[0] as typeof tracked & { ownerNodeIds: string[] }
  assert.notEqual(familyPoint, tracked)
  assert.equal(familyPoint.metadata, metadata)
  assert.equal(familyPoint[symbol], metadata)
  const ownerPair = familyPoint.ownerNodeIds
  tracked.y = 0.7
  metadata.labels.push("later")
  solver.step()
  const redistributed = solver.mapOfOwnerPairToPortPoints.get("a|b")!
  assert.notEqual(redistributed, family)
  assert.notEqual(redistributed[0], familyPoint)
  assert.equal(redistributed[0]!.ownerNodeIds, ownerPair)
  solver.step()
  const output = solver.getOutput()[0]!
  assert.notEqual(output, node)
  assert.equal(output.center, node.center)
  assert.notEqual(output.portPoints[0], tracked)
  assert.equal(output.portPoints[1], untracked)
  assert.notEqual(output.portPoints[0], output.portPointsInPairs![0]![0])
  assert.equal(output.portPointsInPairs![0]![1], untracked)
  return snapshot(solver)
}

assert.deepEqual(aliases(UniformPortDistributionSolver), aliases(Reference))

// Repeated port IDs use only find's first match in each input node, and an
// invalid but truthy owner array stops the scan before a later valid match.
for (const connectionNodeIds of [undefined, null, [], ["a"], ["", "b"], ["a", "b"]]) {
  const input = structuredClone(fixture) as unknown as UniformPortDistributionSolverInput
  input.inputNodesWithPortPoints.unshift({
    capacityMeshNodeId: "first",
    portPoints: [
      { portPointId: "p_ab", connectionNodeIds },
      { portPointId: "p_ab", connectionNodeIds: ["node_a", "node_b"] },
    ],
  } as typeof input.inputNodesWithPortPoints[number])
  compare(input)
}

console.log("Uniform-port constructor state, exact steps, owner ordering and shallow aliases match the frozen reference")

const nativeRedistribution = await import("../../../lib/solvers/UniformPortDistributionSolver/redistributePortPointsOnSharedEdge")
const referenceRedistribution = await importReference<typeof nativeRedistribution>("lib/solvers/UniformPortDistributionSolver/redistributePortPointsOnSharedEdge.ts")
const nativeIgnorePoint = await import("../../../lib/solvers/UniformPortDistributionSolver/shouldIgnorePortPoint")
const referenceIgnorePoint = await importReference<typeof nativeIgnorePoint>("lib/solvers/UniformPortDistributionSolver/shouldIgnorePortPoint.ts")
const nativeIgnoreEdge = await import("../../../lib/solvers/UniformPortDistributionSolver/shouldIgnoreSharedEdge")
const referenceIgnoreEdge = await importReference<typeof nativeIgnoreEdge>("lib/solvers/UniformPortDistributionSolver/shouldIgnoreSharedEdge.ts")
const sampleEdge = [...new Reference(structuredClone(fixture) as UniformPortDistributionSolverInput).mapOfOwnerPairToSharedEdge.values()][0]!
for (const orientation of ["horizontal", "vertical"] as const) {
  for (const coordinate of [-0, 0.5, Number.NaN, Infinity, -Infinity]) {
    const edge = { ...sampleEdge, orientation, x1: coordinate, y1: -0, length: 2 }
    const symbol = Symbol.for("uniform-helper-metadata")
    const metadata = { nested: ["shared"] }
    const layers = [undefined, Number.NaN, 1, -0, Infinity, -Infinity, Number.NaN, 0, undefined]
    const points = layers.map((z, index) => ({
      portPointId: `p${index}`, connectionName: "net", ownerPairKey: "a|b", ownerNodeIds: ["a", "b"] as [string, string],
      x: index % 2 ? -0 : coordinate, y: coordinate, z, metadata, [symbol]: metadata,
    }))
    const params = { sharedEdge: edge, portPoints: points } as Parameters<typeof nativeRedistribution.redistributePortPointsOnSharedEdge>[0]
    const expected = referenceRedistribution.redistributePortPointsOnSharedEdge(params)
    const actual = nativeRedistribution.redistributePortPointsOnSharedEdge(params)
    assert.deepEqual(actual, expected, `helper/${orientation}/${coordinate}`)
    assert.deepEqual(actual.map(point => point.portPointId), expected.map(point => point.portPointId), "Stable layer/coordinate tie order")
    for (const result of actual) {
      const source = points.find(point => point.portPointId === result.portPointId)!
      assert.notEqual(result, source)
      assert.equal(result.metadata, metadata)
      assert.equal(result[symbol], metadata)
      assert.equal(result.ownerNodeIds, source.ownerNodeIds)
    }
    assert.deepEqual(nativeRedistribution.redistributePortPointsOnSharedEdge({ sharedEdge: edge, portPoints: [] }), [])
  }
}

function mutatedPublicState(Solver: typeof Reference): unknown[] {
  const input = structuredClone(fixture) as UniformPortDistributionSolverInput
  const solver = new Solver(input)
  const states: unknown[] = []
  const capture = (): void => { states.push(structuredClone(snapshot(solver))) }
  const key = solver.ownerPairsToProcess[0]!
  const family = solver.mapOfOwnerPairToPortPoints.get(key)!
  const edge = solver.mapOfOwnerPairToSharedEdge.get(key)!
  const bounds = solver.mapOfNodeIdToBounds
  // Missing queue keys are consumed without rebuilding or changing families.
  solver.ownerPairsToProcess.unshift("missing-public-edge")
  solver.step(); capture()
  assert.equal(solver.mapOfNodeIdToBounds, bounds)
  // Replace Maps, queue, edge and family through the existing public API.
  solver.mapOfOwnerPairToSharedEdge = new Map([[key, { ...edge, y1: -0, y2: 2, length: 2 }]])
  solver.mapOfOwnerPairToPortPoints = new Map([[key, family.map((point, index) => ({ ...point, x: -0, y: 0, z: index ? Number.NaN : undefined }))]]) as typeof solver.mapOfOwnerPairToPortPoints
  solver.ownerPairsToProcess = [key]
  const firstOwner = family[0]!.ownerNodeIds[0]
  const owner = input.inputNodesWithPortPoints.find(node => node.capacityMeshNodeId === firstOwner)!
  owner._containsTarget = true
  solver.step(); capture()
  owner._containsTarget = false
  const sourcePoint = owner.portPoints.find(point => point.portPointId === family[0]!.portPointId)
  const target = { ...owner, capacityMeshNodeId: "live-target", _containsTarget: true, portPoints: [] }
  input.inputNodesWithPortPoints.push(target)
  if (sourcePoint) sourcePoint.connectionNodeIds = ["live-target"]
  solver.mapOfOwnerPairToPortPoints.set(key, family)
  solver.ownerPairsToProcess.push(key)
  solver.step(); capture()
  if (sourcePoint) sourcePoint.connectionNodeIds = [...family[0]!.ownerNodeIds]
  const updatedEdge = solver.mapOfOwnerPairToSharedEdge.get(key)!
  input.obstacles.push({ type: "rect", center: { x: updatedEdge.x1 + 0.5, y: updatedEdge.y1 + 0.5 }, width: 1, height: 1, layers: ["top"] } as typeof input.obstacles[number])
  solver.mapOfOwnerPairToPortPoints.set(key, family)
  solver.ownerPairsToProcess.push(key)
  solver.step(); capture()
  input.obstacles.length = 0
  solver.ownerPairsToProcess.push(key)
  solver.step(); capture()
  solver.rebuildNodes(); capture()
  const firstOutput = solver.getOutput()
  solver.rebuildNodes(); capture()
  assert.notEqual(solver.getOutput(), firstOutput)
  solver.step(); capture()
  const terminal = solver.getOutput()
  solver.step(); capture()
  assert.notEqual(solver.getOutput(), terminal)
  assert.equal(solver.iterations, 0)
  return states
}
assert.deepEqual(mutatedPublicState(UniformPortDistributionSolver), mutatedPublicState(Reference), "Live public inputs, Maps, queue, edges, families and rebuilds")

for (const boundary of [0, -0, 1e-6, -1e-6, Number.NaN, Infinity, -Infinity]) {
  const obstacles = [{ type: "rect", center: { x: boundary, y: -0 }, width: 2, height: 2, layers: ["top"] }]
  const edgeParams = { sharedEdge: { ...sampleEdge, x1: boundary, y1: -1, y2: 1 }, obstacles } as Parameters<typeof nativeIgnoreEdge.shouldIgnoreSharedEdge>[0]
  assert.equal(nativeIgnoreEdge.shouldIgnoreSharedEdge(edgeParams), referenceIgnoreEdge.shouldIgnoreSharedEdge(edgeParams))
}
const ignoreInput = structuredClone(fixture) as UniformPortDistributionSolverInput
const ignoreSolver = new Reference(ignoreInput)
for (const family of ignoreSolver.mapOfOwnerPairToPortPoints.values()) {
  for (const portPoint of family) {
    for (const target of [false, true]) {
      ignoreInput.inputNodesWithPortPoints[0]!._containsTarget = target
      const params = { portPoint, ownerNodeIds: portPoint.ownerNodeIds, inputNodes: ignoreInput.inputNodesWithPortPoints }
      assert.equal(nativeIgnorePoint.shouldIgnorePortPoint(params), referenceIgnorePoint.shouldIgnorePortPoint(params))
    }
  }
}
console.log("Uniform live mutation, helper nonfinite/stable ordering and repeated rebuild parity passed")

function accessorReads(Solver: typeof Reference): { state: unknown; reads: string[] } {
  const input = structuredClone(fixture) as UniformPortDistributionSolverInput
  const solver = new Solver(input)
  const reads: string[] = []
  const key = solver.ownerPairsToProcess[0]!
  const edge = solver.mapOfOwnerPairToSharedEdge.get(key)!
  const track = (object: object, field: string, label: string): void => {
    const stored = Reflect.get(object, field)
    Object.defineProperty(object, field, { enumerable: true, configurable: true,
      get: (): unknown => { reads.push(label); return stored },
    })
  }
  // Install accessors after constructor parsing and after one public step.
  solver.ownerPairsToProcess.unshift("skip-before-accessors")
  solver.step()
  track(edge, "orientation", "edge.orientation")
  track(edge, "length", "edge.length")
  const obstacle = { type: "rect", center: { x: 1e4, y: 1e4 }, width: 1, height: 1, layers: ["top"] }
  input.obstacles.push(obstacle as typeof input.obstacles[number])
  track(obstacle.center, "x", "obstacle.center.x")
  for (const [index, node] of input.inputNodesWithPortPoints.entries()) {
    track(node, "capacityMeshNodeId", `node${index}.id`)
    track(node, "_containsTarget", `node${index}.target`)
  }
  const familyMap = solver.mapOfOwnerPairToPortPoints
  const originalGet = familyMap.get
  const originalSet = familyMap.set
  Object.defineProperty(familyMap, "get", { configurable: true, value: function (this: typeof familyMap, name: string) {
    reads.push(`family.get:${name}`)
    return originalGet.call(this, name)
  } })
  Object.defineProperty(familyMap, "set", { configurable: true, value: function (this: typeof familyMap, name: string, values: typeof familyMap extends Map<string, infer V> ? V : never) {
    reads.push(`family.set:${name}`)
    return originalSet.call(this, name, values)
  } })
  solver.step()
  const stepReads = [...reads]
  // Snapshot deliberately excluded from the computation read log.
  return { state: snapshot(solver), reads: stepReads }
}
assert.deepEqual(accessorReads(UniformPortDistributionSolver), accessorReads(Reference), "Getter observation and custom family Map methods match between steps")

function helperAccessorReads(redistribute: typeof nativeRedistribution.redistributePortPointsOnSharedEdge): { values: unknown; reads: string[] } {
  const reads: string[] = []
  const edge = { ...sampleEdge }
  for (const key of ["orientation", "length"] as const) {
    const value = edge[key]
    Object.defineProperty(edge, key, { enumerable: true, configurable: true, get: (): unknown => { reads.push(key); return value } })
  }
  const point = { portPointId: "getter-port", connectionName: "n", x: 0, y: 0, z: 0, ownerNodeIds: ["a", "b"] as [string,string], ownerPairKey: "a|b" }
  const values = redistribute({ sharedEdge: edge, portPoints: [point, { ...point, portPointId: "second" }] })
  return { values, reads }
}
assert.deepEqual(helperAccessorReads(nativeRedistribution.redistributePortPointsOnSharedEdge), helperAccessorReads(referenceRedistribution.redistributePortPointsOnSharedEdge), "Public helper getter read count/order")
console.log("Uniform accessor and custom Map observation parity passed")

function customCollectionReads(ignore: typeof nativeIgnorePoint.shouldIgnorePortPoint): { result: boolean; reads: string[] } {
  const reads: string[] = []
  const connectionNodeIds = ["ordinary"]
  const sourcePoint = { portPointId: "p", connectionNodeIds }
  const portPoints = [sourcePoint]
  const owner = { capacityMeshNodeId: "a", _containsTarget: false, portPoints }
  const target = { capacityMeshNodeId: "target", _containsTarget: true, portPoints: [] }
  const inputNodes = [owner, target]
  Object.defineProperty(inputNodes, "find", { configurable: true, value: function (this: typeof inputNodes, predicate: (value: typeof owner, index: number, array: typeof inputNodes) => unknown) {
    assert.equal(this, inputNodes, "inputNodes.find receiver")
    reads.push("inputNodes.find")
    return Array.prototype.find.call(this, (value: typeof owner, index: number, array: typeof inputNodes): unknown => {
      const result = predicate(value, index, array)
      reads.push(`inputNodes.predicate:${value.capacityMeshNodeId}:${Boolean(result)}`)
      return result
    })
  } })
  Object.defineProperty(portPoints, "find", { configurable: true, value: function (this: typeof portPoints, predicate: (value: typeof sourcePoint, index: number, array: typeof portPoints) => unknown) {
    assert.equal(this, portPoints, "portPoints.find receiver")
    reads.push("portPoints.find")
    assert.equal(Boolean(predicate(sourcePoint, 0, this)), true)
    // The method return value, not the array contents, determines connectivity.
    return { ...sourcePoint, connectionNodeIds }
  } })
  Object.defineProperty(connectionNodeIds, "some", { configurable: true, value: function (this: typeof connectionNodeIds, predicate: (value: string, index: number, array: typeof connectionNodeIds) => unknown) {
    assert.equal(this, connectionNodeIds, "connectionNodeIds.some receiver")
    reads.push("connectionNodeIds.some")
    const result = predicate("target", 0, this)
    reads.push(`connectionNodeIds.predicate:${Boolean(result)}`)
    return Boolean(result)
  } })
  const portPoint = { portPointId: "p", connectionName: "n", x: 0, y: 0, z: 0 }
  const result = ignore({ portPoint, ownerNodeIds: ["a", "b"], inputNodes } as Parameters<typeof ignore>[0])
  return { result, reads }
}
const referenceCustomCollections = customCollectionReads(referenceIgnorePoint.shouldIgnorePortPoint)
assert.equal(referenceCustomCollections.result, true, "Overridden some supplies target absent from underlying IDs")
assert.deepEqual(customCollectionReads(nativeIgnorePoint.shouldIgnorePortPoint), referenceCustomCollections, "Custom find/some methods, callback order and receivers")
console.log("Uniform custom input collection methods match frozen reference")

function reentrantObstacleReads(ignore: typeof nativeIgnoreEdge.shouldIgnoreSharedEdge): { result: boolean; nested: boolean[]; reads: string[] } {
  const reads: string[] = []
  const nested: boolean[] = []
  const edge = { ...sampleEdge, orientation: "vertical" as const, x1: 0, x2: 0, y1: -1, y2: 1 }
  const makeObstacle = (label: string, x: number, reenter: boolean): Parameters<typeof ignore>[0]["obstacles"][number] => {
    const center = {
      get x(): number { reads.push(`${label}.x`); return x },
      get y(): number { reads.push(`${label}.y`); return 0 },
    }
    return {
      center,
      get width(): number {
        reads.push(`${label}.width`)
        if (reenter) nested.push(ignore({ sharedEdge: edge, obstacles: [makeObstacle("nested", 10, false)] }))
        return 2
      },
      get height(): number { reads.push(`${label}.height`); return 2 },
      layers: ["top"], connectedTo: [],
    }
  }
  const result = ignore({ sharedEdge: edge, obstacles: [makeObstacle("outer", 1, true)] })
  return { result, nested, reads }
}
const expectedReentrantObstacleReads = reentrantObstacleReads(referenceIgnoreEdge.shouldIgnoreSharedEdge)
assert.equal(expectedReentrantObstacleReads.result, true, "Outer edge coincides with the obstacle boundary")
assert.deepEqual(expectedReentrantObstacleReads.nested, [false, false], "Nested obstacles do not cover the edge")
assert.deepEqual(reentrantObstacleReads(nativeIgnoreEdge.shouldIgnoreSharedEdge), expectedReentrantObstacleReads, "Reentrant obstacle getters retain independent scalar snapshots and original read order")
console.log("Uniform reentrant obstacle getter parity passed")

function rebuildCollectionMethods(Solver: typeof UniformPortDistributionSolver): { reads: string[]; output: unknown; retained: unknown } {
  const input = structuredClone(fixture) as UniformPortDistributionSolverInput
  const solver = new Solver(input)
  const reads: string[] = []
  let retainedMapper: ((point: any) => any) | undefined
  const originalNode = input.nodeWithPortPoints[0]!
  const originalPoint = originalNode.portPoints[0]!
  const sourcePoints = [originalPoint]
  Object.defineProperty(sourcePoints, "map", { value: function(this: typeof sourcePoints, callback: (point: any, index: number, array: any[]) => any): unknown[] {
    assert.equal(this, sourcePoints)
    reads.push("points.map")
    retainedMapper = callback
    return [callback({ ...originalPoint, marker: "synthetic-point" }, 7, this)]
  } })
  const sourcePairs = [[originalPoint, originalPoint]]
  Object.defineProperty(sourcePairs, "map", { value: function(this: typeof sourcePairs, callback: (pair: any, index: number, array: any[]) => any): unknown[] {
    assert.equal(this, sourcePairs)
    reads.push("pairs.map")
    return [callback([originalPoint, { ...originalPoint, marker: "synthetic-end" }], 9, this)]
  } })
  const syntheticNode = { ...originalNode, portPoints: sourcePoints, portPointsInPairs: sourcePairs }
  const nodes = input.nodeWithPortPoints
  Object.defineProperty(nodes, "map", { value: function(this: typeof nodes, callback: (node: any, index: number, array: any[]) => any): unknown[] {
    assert.equal(this, nodes)
    reads.push("nodes.map")
    return [callback(syntheticNode, 4, this)]
  } })
  solver.rebuildNodes()
  assert.ok(retainedMapper)
  const retained = retainedMapper({ ...originalPoint, marker: "after-return" })
  return { reads, output: solver.getOutput(), retained }
}
assert.deepEqual(rebuildCollectionMethods(UniformPortDistributionSolver), rebuildCollectionMethods(Reference), "Rebuild invokes original map methods, honors synthetic return values, and keeps escaped callbacks usable")

class UniformMapSpecies<T> extends Array<T> {}
class UniformSourceArray<T> extends Array<T> {
  static get [Symbol.species](): typeof UniformMapSpecies { return UniformMapSpecies }
}
function rebuildArraySpecies(Solver: typeof UniformPortDistributionSolver): { kinds: boolean[]; output: unknown } {
  const input = structuredClone(fixture) as UniformPortDistributionSolverInput
  const solver = new Solver(input)
  const node = input.nodeWithPortPoints[0]!
  const point = node.portPoints[0]!
  const points = new UniformSourceArray<typeof point>()
  points.length = 3
  points[1] = point
  const pairs = new UniformSourceArray<[typeof point, typeof point]>()
  pairs.length = 2
  pairs[1] = [point, point]
  const nodes = new UniformSourceArray<typeof node>()
  nodes.length = 2
  nodes[1] = { ...node, portPoints: points, portPointsInPairs: pairs }
  input.nodeWithPortPoints = nodes
  solver.rebuildNodes()
  const result = solver.getOutput()
  return { kinds: [result instanceof UniformMapSpecies, result[1]!.portPoints instanceof UniformMapSpecies, result[1]!.portPointsInPairs instanceof UniformMapSpecies, !(0 in result), !(0 in result[1]!.portPoints), !(0 in result[1]!.portPointsInPairs!)], output: result }
}
const expectedSpecies = rebuildArraySpecies(Reference)
assert.ok(expectedSpecies.kinds.every(Boolean))
assert.deepEqual(rebuildArraySpecies(UniformPortDistributionSolver), expectedSpecies, "Rebuild map preserves species and holes at all three array levels")
console.log("Uniform rebuild collection methods, escaped callbacks and species match frozen reference")
