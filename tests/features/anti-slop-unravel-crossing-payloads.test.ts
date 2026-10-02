import { expect, test } from "bun:test"
import { getIssuesInSection } from "lib/solvers/UnravelSolver/getIssuesInSection"
import type { UnravelSection } from "lib/solvers/UnravelSolver/types"
import type { CapacityMeshNode } from "lib/types"

test("checked crossing construction preserves all layer variants and undeclared runtime metadata", () => {
  const pair1: [string, string] = ["a", "b"]
  const pair2: [string, string] = ["c", "d"]
  const node: CapacityMeshNode = {
    capacityMeshNodeId: "n",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    layer: "top",
    availableZ: [0, 1],
  }
  const variants = [
    { layers: [0, 0, 0, 0], type: "same_layer_crossing", vias: 0 },
    { layers: [0, 0, 0, 1], type: "single_transition_crossing", vias: 1 },
    { layers: [0, 1, 0, 0], type: "single_transition_crossing", vias: 1 },
    { layers: [0, 1, 1, 0], type: "double_transition_crossing", vias: 2 },
  ] as const

  for (const { layers, type, vias } of variants) {
    const section: UnravelSection = {
      allNodeIds: ["n"],
      mutableNodeIds: [],
      mutableSegmentIds: new Set(),
      immutableNodeIds: [],
      segmentPointMap: new Map(),
      mutableSegmentPointIds: new Set(),
      zLockedSegmentPointIds: new Set(),
      segmentPairsInNode: new Map([["n", [pair1, pair2]]]),
      segmentPointsInNode: new Map(),
      segmentPointsInSegment: new Map(),
      originalPointMap: new Map([
        ["a", { x: -1, y: 0, z: layers[0]! }],
        ["b", { x: 1, y: 0, z: layers[1]! }],
        ["c", { x: 0, y: -1, z: layers[2]! }],
        ["d", { x: 0, y: 1, z: layers[3]! }],
      ]),
    }
    const issues = getIssuesInSection(
      section,
      new Map([["n", node]]),
      new Map(),
    )
    expect(issues.map((issue) => issue.type)).toEqual([
      ...Array.from({ length: vias }, () => "transition_via" as const),
      type,
    ])
    const crossing = issues.at(-1)!
    const entries = Object.entries(crossing)
    expect(entries.slice(0, 3)).toEqual([
      ["type", type],
      ["segmentPoints", [pair1, pair2]],
      ["capacityMeshNodeId", "n"],
    ])
    const payload = entries[1]![1]
    expect(Array.isArray(payload)).toBe(true)
    if (!Array.isArray(payload)) throw new Error("Missing crossing metadata")
    expect(payload[0]).toBe(pair1)
    expect(payload[1]).toBe(pair2)
    expect(entries.at(-1)).toEqual(["probabilityOfFailure", 0])

    if (crossing.type === "single_transition_crossing") {
      const firstPairTransitions = layers[0] !== layers[1]
      expect(crossing.sameLayerCrossingLine).toBe(
        firstPairTransitions ? pair2 : pair1,
      )
      expect(crossing.transitionCrossingLine).toBe(
        firstPairTransitions ? pair1 : pair2,
      )
    } else if (
      crossing.type === "same_layer_crossing" ||
      crossing.type === "double_transition_crossing"
    ) {
      expect(crossing.crossingLine1).toBe(pair1)
      expect(crossing.crossingLine2).toBe(pair2)
    } else {
      throw new Error("Missing crossing issue")
    }
  }
})
