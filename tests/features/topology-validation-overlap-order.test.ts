import { expect, test } from "bun:test"
import type { CapacityMeshNode } from "lib/types"
import {
  validateTopologyMergingOutput,
  type TopologyMergingOutputProvenance,
} from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import {
  TOPOLOGY_PROVENANCE_EPSILON,
  type PreparedTopologyMergingNode,
} from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import { getCapacityMeshNodeBounds } from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import { validateOriginalTopologyMergingOutput } from "../fixtures/topology-validation-original"

type ValidationInput = {
  nodes: CapacityMeshNode[]
  preparedNodeBySourceKey: Map<string, PreparedTopologyMergingNode>
  provenance: TopologyMergingOutputProvenance
}

function node(id: string, x: number, y = 0, width = 2): CapacityMeshNode {
  return {
    capacityMeshNodeId: id,
    center: { x, y },
    width,
    height: 2,
    layer: "top",
    availableZ: [0],
  }
}

function input(nodes: CapacityMeshNode[]): ValidationInput {
  return {
    nodes,
    preparedNodeBySourceKey: new Map(),
    provenance: {
      sourceKeysByNodeId: new Map(
        nodes.map((entry) => [entry.capacityMeshNodeId, []]),
      ),
      groupIndexesByNodeId: new Map(
        nodes.map((entry, index) => [entry.capacityMeshNodeId, [index]]),
      ),
    },
  }
}

function errorMessage(
  validator: typeof validateTopologyMergingOutput,
  params: ValidationInput,
): string | undefined {
  try {
    validator(params)
    return undefined
  } catch (error) {
    return error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error)
  }
}

test("topology indexing preserves error order and geometry hooks", () => {
  const overlapError =
    'Error: TopologyMergingSolver: output nodes "A" and "B" have an unresolved inter-group overlap on a shared layer'
  const compare = (create: () => ValidationInput, expected?: string): void => {
    const actual = errorMessage(validateTopologyMergingOutput, create())
    const original = errorMessage(
      validateOriginalTopologyMergingOutput,
      create(),
    )
    expect(actual).toBe(original)
    if (expected !== undefined) expect(actual).toBe(expected)
  }
  const competingPairs = (): ValidationInput =>
    input([
      { ...node("A", 0, 0, 20), height: 20 },
      node("B", 8, 8, 4),
      node("C", -8, -8, 4),
      ...Array.from({ length: 40 }, (_, index) =>
        node(`remote-${index}`, 100 + index * 4),
      ),
    ])
  compare(competingPairs, overlapError)
  compare(() => {
    const params = competingPairs()
    params.nodes[2]!.width = -1
    return params
  }, 'Error: TopologyMergingSolver: output node "C" has invalid bounds')
  compare(() => {
    const params = competingPairs()
    params.nodes[2]!.center.x = NaN
    return params
  }, 'Error: TopologyMergingSolver: output node "C" has invalid bounds')
  compare(() => {
    const params = competingPairs()
    params.nodes[2]!.center.y = Infinity
    return params
  }, 'Error: TopologyMergingSolver: output node "C" has invalid bounds')
  compare(() => {
    const params = competingPairs()
    params.nodes[2]!.availableZ = []
    return params
  }, 'Error: TopologyMergingSolver: output node "C" has no available layers')
  compare(() => {
    const params = competingPairs()
    params.nodes[2]!.capacityMeshNodeId = "B"
    return params
  }, 'Error: TopologyMergingSolver: duplicate output node id "B"')
  compare(() => {
    const params = competingPairs()
    params.provenance.sourceKeysByNodeId.delete("C")
    return params
  }, 'Error: TopologyMergingSolver: missing output provenance for node "C"')
  compare(() => {
    const params = competingPairs()
    params.provenance.groupIndexesByNodeId.delete("B")
    params.provenance.groupIndexesByNodeId.delete("C")
    return params
  }, 'Error: TopologyMergingSolver: missing output provenance for overlapping nodes "A" and "B"')
  compare(() => {
    const params = competingPairs()
    params.provenance.sourceKeysByNodeId.set("C", ["missing-source"])
    return params
  }, 'Error: TopologyMergingSolver: missing source node for output "C"')

  const epsilon = TOPOLOGY_PROVENANCE_EPSILON
  compare(() => input([node("A", 0), node("B", 2 - epsilon / 2)]))
  compare(() => input([node("A", 0), node("B", 2 - epsilon * 2)]), overlapError)
  compare(() => input([node("A", 0), node("B", 2 - epsilon)]))
  compare(() => input([node("A", 0), { ...node("B", 0), availableZ: [1] }]))
  compare(
    () =>
      input([
        { ...node("A", 0), availableZ: [NaN, NaN] },
        { ...node("B", 0), availableZ: [NaN] },
      ]),
    overlapError,
  )
  compare(
    () => input([node("A", 50), node("B", "10" as unknown as number, 0, 4)]),
    overlapError,
  )
  compare(() =>
    input([
      node("A", 100),
      { ...node("B", 0), availableZ: "0" as unknown as number[] },
      node("C", 200),
    ]),
  )
  compare(
    () =>
      input([
        node("A", -1e308, 0, 1e298),
        node("B", 1e308, 0, 1e298),
        node("C", -1e308, 0, 1e298),
        ...Array.from({ length: 40 }, (_, index) =>
          node(`remote-${index}`, index * 4),
        ),
      ]),
    'Error: TopologyMergingSolver: output nodes "A" and "C" have an unresolved inter-group overlap on a shared layer',
  )
  compare(() => input([]))
  compare(() => input([node("A", 0)]))

  const preservedSameGroup = (): ValidationInput => {
    const params = input([node("A", 0), node("B", 0.5)])
    for (const entry of params.nodes) {
      const sourceKey = `source-${entry.capacityMeshNodeId}`
      params.provenance.groupIndexesByNodeId.set(entry.capacityMeshNodeId, [3])
      params.provenance.sourceKeysByNodeId.set(entry.capacityMeshNodeId, [
        sourceKey,
      ])
      params.preparedNodeBySourceKey.set(sourceKey, {
        sourceKey,
        groupIndex: 3,
        node: entry,
        bounds: getCapacityMeshNodeBounds(entry),
      })
    }
    return params
  }
  compare(preservedSameGroup)
  compare(() => {
    const params = preservedSameGroup()
    params.preparedNodeBySourceKey.get("source-A")!.bounds.maxX = 0
    return params
  }, 'Error: TopologyMergingSolver: output node "A" escapes its source geometry or layers')

  // Preserve original access order when a layer method moves a later node.
  compare(() => {
    const params = input([node("A", 0), node("B", 100), node("C", 200)])
    Object.defineProperty(params.nodes[0]!.availableZ, "filter", {
      value: function (
        this: number[],
        predicate: (value: number, index: number, array: number[]) => unknown,
      ): number[] {
        params.nodes[1]!.center.x = 0
        return Array.prototype.filter.call(this, predicate)
      },
    })
    return params
  }, overlapError)
  compare(() => {
    const params = input([node("A", 0), node("B", 100), node("C", 200)])
    const originalGet = params.provenance.sourceKeysByNodeId.get
    params.provenance.sourceKeysByNodeId.get = function (
      this: Map<string, string[]>,
      key: string,
    ): string[] | undefined {
      if (key === "C") {
        params.nodes[1]!.center.x = 0
        delete (this as { get?: unknown }).get
      }
      return originalGet.call(this, key)
    }
    return params
  }, overlapError)
  compare(() => {
    const params = input([node("A", 0), node("B", 100), node("C", 200)])
    let reads = 0
    Object.defineProperty(params.nodes[1]!, "center", {
      get(): { x: number; y: number } {
        return { x: ++reads > 1 ? 0 : 100, y: 0 }
      },
    })
    return params
  }, overlapError)
  compare(() => {
    const params = input([node("A", 0), node("B", 100), node("C", 200)])
    const originalGet = params.provenance.sourceKeysByNodeId.get
    params.provenance.sourceKeysByNodeId.get = function (
      this: Map<string, string[]>,
      key: string,
    ): string[] | undefined {
      if (key === "C") params.nodes[1]!.center.x = 0
      return originalGet.call(this, key)
    }
    return params
  }, overlapError)
  compare(() => {
    const params = input([node("A", 0), node("B", 0), node("C", 200)])
    const groups = params.provenance.groupIndexesByNodeId
    Object.defineProperty(params.provenance, "groupIndexesByNodeId", {
      get(): Map<string, number[]> {
        params.nodes[2]!.center.x = 0
        return groups
      },
    })
    return params
  }, overlapError)

  let seed = 0x18b0a1d5
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed >>> 8
  }
  for (let sample = 0; sample < 64; sample++) {
    const nodes = Array.from({ length: 24 }, (_, index) => ({
      ...node(
        `node-${index}`,
        random() % 30,
        random() % 30,
        1 + (random() % 4),
      ),
      availableZ: [random() % 4],
    }))
    compare(() => input(structuredClone(nodes)))
  }
})
