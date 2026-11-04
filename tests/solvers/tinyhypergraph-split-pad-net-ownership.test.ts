import { expect, test } from "bun:test"
import type { RegionId } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { assignDisconnectedTargetRegionNetIds } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/assignDisconnectedTargetRegionNetIds"
import type { CapacityMeshNode } from "lib/types"
import {
  CLOCK_NET_ID,
  createSplitPadContactFixture,
  FOREIGN_NET_ID,
} from "tests/fixtures/createSplitPadContactFixture"

type ContactCase = {
  name: string
  fragment?: Partial<CapacityMeshNode>
  fragmentNetId?: number
  conflictingOwners?: boolean
  alreadyConnected?: boolean
  expectedNetId?: number
  expectedNextNetId?: number
}

const cases: ContactCase[] = [
  {
    name: "missing pad contacts",
    expectedNetId: CLOCK_NET_ID,
    expectedNextNetId: CLOCK_NET_ID,
  },
  {
    name: "already connected",
    alreadyConnected: true,
    expectedNetId: CLOCK_NET_ID,
    expectedNextNetId: CLOCK_NET_ID,
  },
  { name: "corner-only contact", fragment: { center: { x: 1, y: 1 } } },
  { name: "another target", fragment: { _targetConnectionName: "foreign" } },
  { name: "unknown copper", fragment: { _connectedTo: ["unknown"] } },
  { name: "foreign copper", fragment: { _connectedTo: ["foreign"] } },
  {
    name: "foreign owner",
    fragmentNetId: FOREIGN_NET_ID,
    expectedNetId: FOREIGN_NET_ID,
  },
  { name: "conflicting owners", conflictingOwners: true },
  { name: "free space", fragment: { _containsObstacle: false } },
  { name: "not a target pad", fragment: { _containsTarget: false } },
]

test("only missing same-pad contacts receive ownership", (): void => {
  for (const scenario of cases) {
    const fixture = createSplitPadContactFixture(scenario.fragment)
    if (scenario.fragmentNetId !== undefined) {
      fixture.regionNetIdByRegionId.set("fragment", scenario.fragmentNetId)
    }
    if (scenario.conflictingOwners) {
      fixture.regionNetCandidates = new Map<RegionId, Set<number>>([
        ["fragment", new Set([CLOCK_NET_ID, FOREIGN_NET_ID])],
      ])
    }
    if (scenario.alreadyConnected) {
      fixture.regionNetIdByRegionId.set("fragment", CLOCK_NET_ID)
      fixture.regionNetIdByRegionId.set("next_fragment", CLOCK_NET_ID)
      fixture.sideBranch.d._containsObstacle = true
    }
    const originalRegions = structuredClone(fixture.regions)
    assignDisconnectedTargetRegionNetIds(fixture)

    const owners = fixture.regionNetIdByRegionId
    expect(owners.get("fragment"), scenario.name).toBe(scenario.expectedNetId)
    expect(owners.get("next_fragment"), scenario.name).toBe(
      scenario.expectedNextNetId,
    )
    expect(owners.has("side_branch"), scenario.name).toBe(false)
    expect(owners.get("terminal"), scenario.name).toBe(CLOCK_NET_ID)
    expect(owners.get("destination"), scenario.name).toBe(-1)
    expect(fixture.regions, scenario.name).toEqual(originalRegions)
  }
})
