import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPortPointFamilyPositionGuard } from "lib/solvers/UniformPortDistributionSolver/createPortPointFamilyPositionGuard"
import { UniformPortDistributionSolver, type UniformPortDistributionSolverInput } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import actual from "../fixtures/sample24-uniform-peer-families.json"

test("atomic Uniform families retain nominal peer clearance across families, aliases and accepted moves", () => {
  const connMap = new ConnectivityMap({
    connectivity_net77: ["source_net_altium_pcb_332"], connectivity_net118: ["source_net_altium_pcb_291"],
    connectivity_net0: ["a", "a-alias"], netB: ["b"], netC: ["c"],
  })
  const input: UniformPortDistributionSolverInput = {
    nodeWithPortPoints: structuredClone(actual.nodes) as NodeWithPortPoints[],
    inputNodesWithPortPoints: structuredClone(actual.inputNodes) as UniformPortDistributionSolverInput["inputNodesWithPortPoints"],
    obstacles: [], layerCount: 8, useLayerAwareGeometry: true,
  }
  const before = JSON.stringify(input)
  const original = input.nodeWithPortPoints.find((n) => n.capacityMeshNodeId === "new-cmn_919-5168__sub_3_0")!.portPoints
  expect(Math.hypot(original[0]!.x - original[1]!.x, original[0]!.y - original[1]!.y)).toBeCloseTo(0.338012978830729, 12)
  const legacy = new UniformPortDistributionSolver(input)
  legacy.solve()
  const old = legacy.getOutput().find((n) => n.capacityMeshNodeId === "new-cmn_919-5168__sub_3_0")!.portPoints
  expect(Math.hypot(old[0]!.x - old[1]!.x, old[0]!.y - old[1]!.y)).toBeCloseTo(0.18420192331431057, 12)
  const guarded = new UniformPortDistributionSolver({ ...input,
    admitPortPointFamily: createPortPointFamilyPositionGuard({ nodes: input.nodeWithPortPoints,
      connMap, minimumCenterDistance: 0.2, layerCount: 8 }),
  })
  guarded.solve()
  const output = guarded.getOutput().find((n) => n.capacityMeshNodeId === "new-cmn_919-5168__sub_3_0")!.portPoints
  expect(guarded.solved).toBe(true)
  expect(Math.hypot(output[0]!.x - output[1]!.x, output[0]!.y - output[1]!.y)).toBeGreaterThanOrEqual(0.2)
  expect(output[1]).toEqual(original[1])
  expect(JSON.stringify(input)).toBe(before)

  const point = (id: string, x: number, name: string, z = 0): PortPoint => ({
    portPointId: id, x, y: 0, z, connectionName: name,
  })
  const nodes = (points: PortPoint[]): NodeWithPortPoints[] => [{
    capacityMeshNodeId: "points", center: { x: 0, y: 0 }, width: 10, height: 10,
    availableZ: [0, 1], portPoints: points,
  }]
  const originals = [point("a", 0, "a"), point("b", 1, "b"), point("c", 3, "c")]
  const originalsBefore = JSON.stringify(originals)
  const admit = createPortPointFamilyPositionGuard({ nodes: nodes(originals), connMap,
    minimumCenterDistance: 0.2, layerCount: 8 })
  // The second moving point vacates x=1 atomically; its old position must not
  // prevent the first from occupying that position.
  expect(admit([point("a", 1, "a-alias"), point("b", 2, "b")])).toBe(true)
  expect(admit([point("c", 0.05, "c")])).toBe(true)
  expect(admit([point("c", 1.05, "c")])).toBe(false)
  expect(admit([point("a", 0.1, "a")])).toBe(false)
  expect(JSON.stringify(originals)).toBe(originalsBefore)
  expect(() => admit([point("missing", 9, "c")])).toThrow("identity")
  expect(() => admit([point("c", 9, "c"), point("c", 10, "c")])).toThrow("Duplicate")
  expect(() => createPortPointFamilyPositionGuard({ nodes: nodes([point("a", 0, "a"), point("b", 0.19, "b")]),
    connMap, minimumCenterDistance: 0.2, layerCount: 8 })).toThrow("Original used port")
  const sameOwner = createPortPointFamilyPositionGuard({ nodes: nodes([point("a", 0, "a"), point("alias", 0.001, "a-alias")]),
    connMap, minimumCenterDistance: 0.2, layerCount: 8 })
  expect(sameOwner([point("alias", 0, "a-alias")])).toBe(true)
  const collidingNames = new ConnectivityMap({ canonical0: ["alias0"], canonical1: ["canonical0", "alias1"] })
  const canonicalRoot = { ...point("root", 0, "unregistered-mst"), rootConnectionName: "canonical0" }
  const canonical = createPortPointFamilyPositionGuard({ nodes: nodes([canonicalRoot, point("alias", 0.001, "alias0"), point("other", 1, "alias1")]),
    connMap: collidingNames, minimumCenterDistance: 0.2, layerCount: 8 })
  expect(canonical([{ ...canonicalRoot, x: 0.002 }])).toBe(true)
  expect(canonical([point("other", 0.003, "alias1")])).toBe(false)
  const layers = createPortPointFamilyPositionGuard({ nodes: nodes([point("a", 0, "a"), point("b", 0, "b", 1)]),
    connMap, minimumCenterDistance: 0.2, layerCount: 8 })
  expect(layers([point("b", 0.001, "b", 1)])).toBe(true)
  const bare = createPortPointFamilyPositionGuard({ nodes: nodes([point("a", 0, "a"), point("b", 0.15, "b")]),
    connMap, minimumCenterDistance: 0.1, layerCount: 8 })
  expect(bare([point("b", 0.1, "b")])).toBe(true)
  expect(bare([point("b", 0.099, "b")])).toBe(false)

  const pair: [string, string] = ["above", "below"]
  const family = [point("a", 0, "a"), point("b", 0.7, "b")]
  const familyNodes: NodeWithPortPoints[] = pair.map((id, index) => ({
    capacityMeshNodeId: id, center: { x: 0.35, y: index === 0 ? 0.5 : -0.5 }, width: 0.7, height: 1,
    availableZ: [0], portPoints: family.map((p) => ({ ...p })),
  }))
  const familyInput: UniformPortDistributionSolverInput = { nodeWithPortPoints: familyNodes,
    inputNodesWithPortPoints: familyNodes.map((node) => ({ ...node,
      portPoints: node.portPoints.map((p) => ({ ...p, connectionNodeIds: pair, distToCentermostPortOnZ: 0 })),
    })), obstacles: [], layerCount: 8, useLayerAwareGeometry: true }
  const large = new UniformPortDistributionSolver({ ...familyInput,
    admitPortPointFamily: createPortPointFamilyPositionGuard({ nodes: familyNodes, connMap,
      minimumCenterDistance: 0.4, layerCount: 8 }),
  })
  large.solve()
  // Foreign proposed positions .175/.525 are .35 apart: reject the whole batch.
  expect(large.getOutput()[0]!.portPoints).toEqual(family)
  const admitted: number[][] = []
  const staticFirst = new UniformPortDistributionSolver({ ...familyInput,
    isPortPointPositionAllowed: (p) => p.x !== 0.175,
    admitPortPointFamily: (points) => { admitted.push(points.map((p) => p.x)); return true },
  })
  staticFirst.solve()
  expect(admitted).toEqual([[0, 0.7]])
})
