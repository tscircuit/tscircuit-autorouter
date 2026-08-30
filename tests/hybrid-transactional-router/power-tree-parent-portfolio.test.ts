import { expect, test } from "bun:test"
import { createPowerTreeBranchSearches } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/power-tree-branch-portfolio"
import { copperPrimitivesContainGraphCycle } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/coupled-route-constraints"
import type { HybridCopperSegment } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-types"
import type { RegionJob } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/worker-protocol"

test("bounds alternate power-tree parents to already connected terminals", () => {
  const firstSearch = {
    searchId: "first",
    connectionRuleReference: "power",
    start: { x: 0, y: 0, layer: "top" },
    goal: { x: 2, y: 0, layer: "top" },
    connectedTerminalIds: ["a", "b"],
    remainingViaBudget: 4,
  }
  const secondSearch = {
    searchId: "second",
    connectionRuleReference: "power",
    start: { x: 2, y: 0, layer: "top" },
    goal: { x: 3, y: 2, layer: "top" },
    connectedTerminalIds: ["b", "c"],
    remainingViaBudget: 4,
  }
  const bounds = { minX: -5, maxX: 5, minY: -5, maxY: 5 }
  const job: RegionJob = {
    protocolVersion: 1,
    jobId: "power-job",
    regionId: "power-region",
    transactionId: "power-transaction",
    ownerRouteObjectId: "power:power",
    boardContextVersion: 0,
    copperVersion: 0,
    boundaryContractVersion: 0,
    bounds,
    envelope: bounds,
    terminalReferences: ["a", "b", "c"],
    boundaryContractReferences: [],
    ownedPreloadedCopperReferences: [],
    searches: [firstSearch, secondSearch],
    coupling: { kind: "power", connectionName: "power", topology: "tree" },
    solverBudget: { maximumExpansions: 1_000, maximumActivationRings: 2 },
    routingResolutionMm: 0.05,
    deterministicSeed: 17,
    congestionCost: 0,
    diagnostic: {
      code: "test",
      message: "test",
      regionIds: ["power-region"],
      connectionNames: ["power"],
    },
  }
  const branches = createPowerTreeBranchSearches({
    job,
    search: secondSearch,
    searchIndex: 1,
    addedTraces: [
      {
        kind: "segment",
        copperId: "first-branch",
        connectionName: "power",
        layer: "top",
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        widthMm: 0.1,
        ownership: {
          mutability: "mutable",
          ownerRouteObjectIds: ["power:power"],
        },
      },
      {
        kind: "segment",
        copperId: "first-branch-end",
        connectionName: "power",
        layer: "top",
        start: { x: 1, y: 1 },
        end: { x: 2, y: 0 },
        widthMm: 0.1,
        ownership: {
          mutability: "mutable",
          ownerRouteObjectIds: ["power:power"],
        },
      },
    ],
  })

  expect(branches).toHaveLength(4)
  expect(branches.map((branch) => branch.connectedTerminalIds)).toEqual([
    ["b", "c"],
    ["b", "c"],
    ["b", "c"],
    ["a", "c"],
  ])
  expect(branches[1]?.start).toEqual({ x: 1.5, y: 0.5, layer: "top" })
  expect(branches[2]?.start).toEqual({ x: 1, y: 1, layer: "top" })
  expect(branches[3]?.start).toEqual({ x: 0, y: 0, layer: "top" })
})

test("detects a cyclic branch candidate before transaction validation", () => {
  const ownership = {
    mutability: "mutable" as const,
    ownerRouteObjectIds: ["power:power"],
  }
  const segment = (
    copperId: string,
    start: { readonly x: number; readonly y: number },
    end: { readonly x: number; readonly y: number },
  ): HybridCopperSegment => ({
    kind: "segment",
    copperId,
    connectionName: "power",
    layer: "top",
    start,
    end,
    widthMm: 0.1,
    ownership,
  })

  expect(
    copperPrimitivesContainGraphCycle({
      segments: [
        segment("a", { x: 0, y: 0 }, { x: 1, y: 0 }),
        segment("b", { x: 1, y: 0 }, { x: 1, y: 1 }),
        segment("c", { x: 1, y: 1 }, { x: 0, y: 0 }),
      ],
      vias: [],
      layerNames: ["top", "bottom"],
    }),
  ).toBe(true)
})
