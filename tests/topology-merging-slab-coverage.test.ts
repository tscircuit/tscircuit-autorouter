import { expect, spyOn, test } from "bun:test"
import Flatbush from "flatbush"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { TOPOLOGY_MERGING_EPSILON } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import { createStripedTopologyMergeInput } from "./fixtures/createStripedTopologyMergeInput"

test("dense topology coverage does not repeat a point index search for every artificial cell", () => {
  const input = createStripedTopologyMergeInput(8)
  const original = JSON.stringify(input)
  const searches = spyOn(Flatbush.prototype, "search")
  try {
    const solver = new TopologyMergingSolver(input)
    while (!solver.solved && !solver.failed) solver.step()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.getOutput()).toHaveLength(48)
    expect(JSON.stringify(input)).toBe(original)
    expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
    const pointCoverageQueries = searches.mock.calls.filter(
      ([minX, minY, maxX, maxY]) =>
        [minX, minY, maxX, maxY].every(Number.isFinite) &&
        maxX - minX <= TOPOLOGY_MERGING_EPSILON * 2.1 &&
        maxY - minY <= TOPOLOGY_MERGING_EPSILON * 2.1,
    ).length
    expect(pointCoverageQueries).toBeLessThanOrEqual(solver.stats.xSlabCount)
  } finally {
    searches.mockRestore()
  }
})
