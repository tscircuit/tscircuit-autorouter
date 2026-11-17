import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import type { Viewbox } from "graphics-debug"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { SingleTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/SingleTargetNecessaryCrampedPortPointSolver"
import type { ExploredPortPoint } from "lib/solvers/NecessaryCrampedPortPointSolver/types"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { renderButterstickCrampedEscape } from "tests/fixtures/renderButterstickCrampedEscape"

type SingleTargetInput = ConstructorParameters<
  typeof SingleTargetNecessaryCrampedPortPointSolver
>[0]
type ButterstickEscapeFixture = {
  targetNodeId: CapacityMeshNodeId
  depthLimit: SingleTargetInput["depthLimit"]
  shouldIgnoreCrampedPortPoints: SingleTargetInput["shouldIgnoreCrampedPortPoints"]
  nodes: CapacityMeshNode[]
  ports: SegmentPortPoint[]
  portsByNodeId: [CapacityMeshNodeId, number[]][]
  viewport: Viewbox
  expected: {
    adjacencyEntries: number
    candidateCount: number
    candidateSha256: string
  }
}

class CountingPortAdjacency extends Map<
  CapacityMeshNodeId,
  SegmentPortPoint[]
> {
  adjacencyEntries = 0

  override get(nodeId: CapacityMeshNodeId): SegmentPortPoint[] | undefined {
    const ports = super.get(nodeId)
    if (ports) {
      this.adjacencyEntries += ports.length
    }
    return ports
  }
}

function getCandidateSignature(candidates: ExploredPortPoint[]): string {
  const paths = candidates.map((candidate) => {
    const path: SegmentPortPoint[] = []
    let parent: ExploredPortPoint | null = candidate
    while (parent) {
      path.unshift(parent.port)
      parent = parent.parent
    }
    return {
      depth: candidate.depth,
      cramped: candidate.countOfCrampedPortPointsInPath,
      path,
    }
  })
  return createHash("sha256").update(JSON.stringify(paths)).digest("hex")
}

test("ButterStick escape search retains native paths through a shared region", async (): Promise<void> => {
  // Native ButterStick stage capture, limited to this physical viewport.
  const compressed = await Bun.file(
    new URL(
      "../fixtures/assets/butterstick-cramped-port-search.json.gz",
      import.meta.url,
    ),
  ).arrayBuffer()
  const fixture: ButterstickEscapeFixture = JSON.parse(
    new TextDecoder().decode(Bun.gunzipSync(compressed)),
  )
  const nodeMap = new Map(
    fixture.nodes.map((node) => [node.capacityMeshNodeId, node]),
  )
  const target = nodeMap.get(fixture.targetNodeId)
  if (!target) throw new Error("Missing native ButterStick escape pad")
  const portsByNodeId = new CountingPortAdjacency(
    fixture.portsByNodeId.map(([nodeId, indices]) => [
      nodeId,
      indices.map((index) => fixture.ports[index]!),
    ]),
  )
  const solver = new SingleTargetNecessaryCrampedPortPointSolver({
    target,
    mapOfCapacityMeshNodeIdToSegmentPortPoints: portsByNodeId,
    mapOfCapacityMeshNodeIdToRef: nodeMap,
    depthLimit: fixture.depthLimit,
    shouldIgnoreCrampedPortPoints: fixture.shouldIgnoreCrampedPortPoints,
  })
  portsByNodeId.adjacencyEntries = 0
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const candidates = solver.getOutput()
  expect(candidates).toHaveLength(fixture.expected.candidateCount)
  expect(getCandidateSignature(candidates)).toBe(
    fixture.expected.candidateSha256,
  )
  expect(portsByNodeId.adjacencyEntries).toBe(fixture.expected.adjacencyEntries)
  await expect(
    renderButterstickCrampedEscape({
      nodes: fixture.nodes,
      targetNodeId: fixture.targetNodeId,
      candidates,
      viewport: fixture.viewport,
      adjacencyEntries: portsByNodeId.adjacencyEntries,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
