import { expect, test } from "bun:test"
import { pinPipeline9PreloadedSectionEndpoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pinPipeline9PreloadedSectionEndpoints"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { createPreloadedSeamFixture } from "../fixtures/pipeline9-preloaded-seam-fixture"

test("certified preload seams pin every replica and reject invalid ownership, incidence and source copper", (): void => {
  const fixture = createPreloadedSeamFixture()
  const before = structuredClone(fixture)
  const pinned = pinPipeline9PreloadedSectionEndpoints(fixture)
  expect(fixture).toEqual(before)
  expect(pinned.endpointCount).toBe(2)
  expect(pinned.pinnedReplicaCount).toBe(5)
  expect(pinned.ownedConnectors).toHaveLength(0)
  expect(pinned.maximumDisplacement).toBe(0.08)
  for (const node of pinned.nodes) {
    for (const point of [...node.portPoints, ...(node.portPointsInPairs?.flat() ?? [])]) {
      expect(point.y).toBe(0)
    }
  }
  const distribution = new UniformPortDistributionSolver({
    nodeWithPortPoints: pinned.nodes, inputNodesWithPortPoints: [], obstacles: [],
    layerCount: 2, useLayerAwareGeometry: true, immutablePortIds: pinned.immutablePortIds,
  })
  distribution.solve()
  expect(distribution.getOutput()).toEqual(pinned.nodes)

  const invalid = (mutate: (input: ReturnType<typeof createPreloadedSeamFixture>) => void, message: string): void => {
    const input = createPreloadedSeamFixture()
    mutate(input)
    expect(() => pinPipeline9PreloadedSectionEndpoints(input)).toThrow(message)
  }
  invalid((input) => { input.witnesses[0]!.rootConnectionName = "foreign" }, "wrong source root")
  invalid((input) => { input.nodes[0]!.portPoints[0]!.rootConnectionName = "foreign" }, "conflicting endpoint replica")
  invalid((input) => { input.witnesses[0]!.incidentCapacityMeshNodeIds = ["wrong", "right"] }, "wrong incident region")
  invalid((input) => { input.nodes[0]!.availableZ = [1] }, "outside incident physical domain")
  invalid((input) => { input.witnesses[0]!.point.z = 1 }, "original copper or layer")
  invalid((input) => { input.nodes[0]!.portPoints[0]!.z = 1 }, "conflicting endpoint replica")
  invalid((input) => { input.witnesses[0]!.routePosition = 0.6 }, "interval identity")
  invalid((input) => { input.witnesses[0]!.point.x = 0.1 }, "original copper or layer")
  invalid((input) => { input.witnesses.pop() }, "lost endpoint witnesses")
  invalid((input) => { input.nodes[0]!.portPoints[0]!.pcb_port_id = "unrelated-pad" }, "conflicting endpoint replica")
  invalid((input) => { input.witnesses[0]!.sourcePortPoint.x = -4 }, "outside incident physical domain")
  invalid((input) => { input.nodes[0]!.center.x = -8 }, "outside incident physical domain")
})
