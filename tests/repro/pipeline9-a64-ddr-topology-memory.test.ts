import { createHash } from "node:crypto"
import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { loadA64DdrTopologyMemoryInput } from "../fixtures/loadA64DdrMemoryFixture"

test.failing(
  "A64 topology merging releases construction regions after preserving its exact output",
  (): void => {
    const input = loadA64DdrTopologyMemoryInput()
    const solver = new TopologyMergingSolver(input)
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.stats.inputNodeCount).toBe(20_586)
    expect(solver.stats.atomicRegionCount).toBe(515_892)
    expect(solver.getOutput()).toHaveLength(36_786)
    expect(
      createHash("sha256")
        .update(JSON.stringify(solver.getOutput()))
        .digest("hex"),
    ).toBe("f2ccbc5b28474693032a8557ed44c9c3eb8706f36db7198b55d5bc5df3462f22")
    expect(solver.getConstructorParams()[0]).toBe(input)
    expect(Reflect.get(solver, "atomicRegions")).toHaveLength(0)
  },
)
