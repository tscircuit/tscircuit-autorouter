import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { ExploredPortPoint } from "lib/solvers/NecessaryCrampedPortPointSolver/types"

type SingleTargetConstructor = typeof import("lib/solvers/NecessaryCrampedPortPointSolver/SingleTargetNecessaryCrampedPortPointSolver").SingleTargetNecessaryCrampedPortPointSolver
type MultiTargetConstructor = typeof import("lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver").MultiTargetNecessaryCrampedPortPointSolver
type SingleTargetSolver = InstanceType<SingleTargetConstructor>
type SingleTargetInput = ConstructorParameters<SingleTargetConstructor>[0]
type MultiTargetInput = ConstructorParameters<MultiTargetConstructor>[0]
type SceneFixture = {
  targetNodeId: CapacityMeshNodeId
  depthLimit: number
  shouldIgnoreCrampedPortPoints: boolean
  nodes: CapacityMeshNode[]
  ports: SegmentPortPoint[]
  portsByNodeId: [CapacityMeshNodeId, number[]][]
  expected: { adjacencyReads: number; adjacencyEntries: number; candidateCount: number; candidateSha256: string }
}
type StepObservation = {
  input: SingleTargetInput
  nodeIdsRead: Set<CapacityMeshNodeId>
  adjacencyReads: number
  adjacencyEntries: number
  candidateCount: number
  candidateSha256: string
}

const [routerDirectory, inputPath, outputDirectory, mode = "time", repeatText = "3"] = process.argv.slice(2)
if (!routerDirectory || !inputPath || !outputDirectory) {
  throw new Error("Expected router checkout, captured input gzip, output directory, time|extract|replay and optional repeat count")
}
mkdirSync(outputDirectory, { recursive: true })
const singlePath = resolve(routerDirectory, "lib/solvers/NecessaryCrampedPortPointSolver/SingleTargetNecessaryCrampedPortPointSolver.ts")
const multiPath = resolve(routerDirectory, "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver.ts")
const SingleTargetNecessaryCrampedPortPointSolver: SingleTargetConstructor = (await import(pathToFileURL(singlePath).href)).SingleTargetNecessaryCrampedPortPointSolver
const MultiTargetNecessaryCrampedPortPointSolver: MultiTargetConstructor = (await import(pathToFileURL(multiPath).href)).MultiTargetNecessaryCrampedPortPointSolver
const serializedInput = new TextDecoder().decode(Bun.gunzipSync(readFileSync(inputPath)))
const originalStep = SingleTargetNecessaryCrampedPortPointSolver.prototype._step
let worst: StepObservation | undefined
let observedSteps = 0
let totalAdjacencyReads = 0
let totalAdjacencyEntries = 0

function sha256(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex")
}

function candidateSignature(candidates: ExploredPortPoint[]): string {
  return sha256(JSON.stringify(candidates.map((candidate) => {
    const path: SegmentPortPoint[] = []
    let parent: ExploredPortPoint | null = candidate
    while (parent) {
      path.unshift(parent.port)
      parent = parent.parent
    }
    return { depth: candidate.depth, cramped: candidate.countOfCrampedPortPointsInPath, path }
  })))
}

function instrumentedStep(this: SingleTargetSolver): void {
  const input: SingleTargetInput = Reflect.get(this, "input")
  const portsByNodeId = input.mapOfCapacityMeshNodeIdToSegmentPortPoints
  const ownGet = Object.getOwnPropertyDescriptor(portsByNodeId, "get")
  const originalGet = portsByNodeId.get
  const nodeIdsRead = new Set<CapacityMeshNodeId>([input.target.capacityMeshNodeId])
  let adjacencyReads = 0
  let adjacencyEntries = 0
  Object.defineProperty(portsByNodeId, "get", {
    configurable: true,
    writable: true,
    value: (nodeId: CapacityMeshNodeId): SegmentPortPoint[] | undefined => {
      const ports = originalGet.call(portsByNodeId, nodeId)
      nodeIdsRead.add(nodeId)
      adjacencyReads++
      adjacencyEntries += ports?.length ?? 0
      return ports
    },
  })
  try {
    originalStep.call(this)
  } finally {
    if (ownGet) Object.defineProperty(portsByNodeId, "get", ownGet)
    else Reflect.deleteProperty(portsByNodeId, "get")
  }
  observedSteps++
  totalAdjacencyReads += adjacencyReads
  totalAdjacencyEntries += adjacencyEntries
  if (!worst || adjacencyEntries > worst.adjacencyEntries) {
    const candidates = this.getOutput()
    worst = { input, nodeIdsRead, adjacencyReads, adjacencyEntries,
      candidateCount: candidates.length, candidateSha256: candidateSignature(candidates) }
  }
}

function makeSceneFixture(observation: StepObservation): SceneFixture {
  const { input, nodeIdsRead } = observation
  const ports: SegmentPortPoint[] = []
  const portIndices = new Map<SegmentPortPoint, number>()
  const referencedNodes = new Set<CapacityMeshNodeId>(nodeIdsRead)
  const portsByNodeId: SceneFixture["portsByNodeId"] = []
  for (const nodeId of nodeIdsRead) {
    const indices: number[] = []
    for (const port of input.mapOfCapacityMeshNodeIdToSegmentPortPoints.get(nodeId) ?? []) {
      let index = portIndices.get(port)
      if (index === undefined) {
        index = ports.length
        portIndices.set(port, index)
        ports.push(port)
      }
      indices.push(index)
      for (const endpoint of port.nodeIds) referencedNodes.add(endpoint)
    }
    portsByNodeId.push([nodeId, indices])
  }
  const nodes = [...referencedNodes].map((nodeId) => {
    const node = input.mapOfCapacityMeshNodeIdToRef.get(nodeId)
    if (!node) throw new Error(`Missing referenced capacity node ${nodeId}`)
    return { capacityMeshNodeId: node.capacityMeshNodeId, center: node.center,
      width: node.width, height: node.height, availableZ: node.availableZ, layer: node.layer,
      _containsObstacle: node._containsObstacle, _containsTarget: node._containsTarget,
      _isComponentTopologyNode: node._isComponentTopologyNode, _connectedTo: node._connectedTo }
  })
  return { targetNodeId: input.target.capacityMeshNodeId, depthLimit: input.depthLimit,
    shouldIgnoreCrampedPortPoints: input.shouldIgnoreCrampedPortPoints, nodes, ports, portsByNodeId,
    expected: { adjacencyReads: observation.adjacencyReads, adjacencyEntries: observation.adjacencyEntries,
      candidateCount: observation.candidateCount, candidateSha256: observation.candidateSha256 } }
}

if (mode === "replay") {
  const scene: SceneFixture = JSON.parse(serializedInput)
  const nodeMap = new Map(scene.nodes.map((node) => [node.capacityMeshNodeId, node]))
  const target = nodeMap.get(scene.targetNodeId)
  if (!target) throw new Error("Replay scene has no target node")
  const input: SingleTargetInput = { target, depthLimit: scene.depthLimit,
    shouldIgnoreCrampedPortPoints: scene.shouldIgnoreCrampedPortPoints,
    mapOfCapacityMeshNodeIdToRef: nodeMap,
    mapOfCapacityMeshNodeIdToSegmentPortPoints: new Map(scene.portsByNodeId.map(([nodeId, indices]) => [nodeId, indices.map((index) => scene.ports[index]!)])) }
  SingleTargetNecessaryCrampedPortPointSolver.prototype._step = instrumentedStep
  const solver = new SingleTargetNecessaryCrampedPortPointSolver(input)
  try { solver.solve() } finally { SingleTargetNecessaryCrampedPortPointSolver.prototype._step = originalStep }
  if (solver.failed) throw new Error(solver.error ?? "Single-target replay failed")
  const result = { mode, adjacencyReads: totalAdjacencyReads, adjacencyEntries: totalAdjacencyEntries,
    candidateCount: solver.getOutput().length, candidateSha256: candidateSignature(solver.getOutput()), expected: scene.expected }
  if (result.candidateSha256 !== scene.expected.candidateSha256) throw new Error("Replay changed complete candidate objects or ordered parent chains")
  writeFileSync(join(outputDirectory, "replay-report.json"), JSON.stringify(result, null, 2))
  console.log("REACHABILITY_REPLAY_RESULT", JSON.stringify(result))
} else if (mode === "time" || mode === "extract") {
  const repeatCount = mode === "extract" ? 1 : Number(repeatText)
  for (let repetition = 0; repetition < repeatCount; repetition++) {
    const input: MultiTargetInput = JSON.parse(serializedInput)
    if (mode === "extract") SingleTargetNecessaryCrampedPortPointSolver.prototype._step = instrumentedStep
    const started = performance.now()
    const solver = new MultiTargetNecessaryCrampedPortPointSolver(input)
    try { solver.solve() } finally { SingleTargetNecessaryCrampedPortPointSolver.prototype._step = originalStep }
    const output = solver.getOutput()
    const elapsedMs = performance.now() - started
    if (solver.failed) throw new Error(solver.error ?? "Necessary-cramped solver failed")
    const result = { mode, repetition: repetition + 1, elapsedMs,
      outputSha256: sha256(JSON.stringify(output)), segments: output.length,
      portPoints: output.reduce((count, segment) => count + segment.portPoints.length, 0),
      observedSteps, totalAdjacencyReads, totalAdjacencyEntries }
    writeFileSync(join(outputDirectory, `${mode}-${repetition + 1}.json`), JSON.stringify(result, null, 2))
    console.log("REACHABILITY_STAGE_RESULT", JSON.stringify(result))
  }
  if (mode === "extract") {
    if (!worst) throw new Error("No single-target searches were observed")
    const fixture = makeSceneFixture(worst)
    writeFileSync(join(outputDirectory, "butterstick-worst-target.json.gz"), Bun.gzipSync(JSON.stringify(fixture)))
    console.log("REACHABILITY_SCENE_RESULT", JSON.stringify({ targetNodeId: fixture.targetNodeId,
      depthLimit: fixture.depthLimit, shouldIgnoreCrampedPortPoints: fixture.shouldIgnoreCrampedPortPoints,
      nodes: fixture.nodes.length, ports: fixture.ports.length, adjacencyNodes: fixture.portsByNodeId.length,
      expected: fixture.expected }))
  }
} else throw new Error(`Unknown runner mode ${mode}`)
