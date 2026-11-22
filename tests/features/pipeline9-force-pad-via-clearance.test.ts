import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"
import { loadDdrForceClearanceFixture } from "../fixtures/loadDdrForceClearanceFixture"

const getSquarePadEdgeGap = (
  via: { x: number; y: number },
  viaDiameter: number,
  pad: { center: { x: number; y: number }; width: number; height: number },
): number => {
  const halfWidth = pad.width / 2
  const halfHeight = pad.height / 2
  const dx = Math.max(
    pad.center.x - halfWidth - via.x,
    0,
    via.x - (pad.center.x + halfWidth),
  )
  const dy = Math.max(
    pad.center.y - halfHeight - via.y,
    0,
    via.y - (pad.center.y + halfHeight),
  )
  return Math.hypot(dx, dy) - viaDiameter / 2
}

test("Pipeline9 force improvement rejects via moves into foreign BGA pad clearance", async (): Promise<void> => {
  const fixture = loadDdrForceClearanceFixture()
  const regionId = "topology_merge_26131"
  const hdRoutes = fixture.hdRoutes.filter(
    (route) => route.regionId === regionId,
  )
  const nodeWithPortPoints = fixture.nodeWithPortPoints.filter(
    (node) => node.capacityMeshNodeId === regionId,
  )
  const foreignBgaPad = {
    type: "rect" as const,
    center: { x: 14.06, y: 0.89 },
    width: 0.36,
    height: 0.36,
    layers: ["top"],
    connectedTo: ["pcb_smtpad_foreign_bga", "foreign_bga_net"],
    circuitJsonMetadata: {
      pcb_smtpad_id: "pcb_smtpad_foreign_bga",
    },
  }
  const originalRoute = hdRoutes.find(
    (route) => route.connectionName === "source_net_114_mst1",
  )!
  const originalGap = getSquarePadEdgeGap(
    originalRoute.vias[0]!,
    originalRoute.viaDiameter,
    foreignBgaPad,
  )
  expect(originalGap).toBeGreaterThanOrEqual(0.1)

  const baseParams = {
    hdRoutes: structuredClone(hdRoutes),
    nodeWithPortPoints: structuredClone(nodeWithPortPoints),
    totalStepsPerNode: 20,
    preserveTopologyPortAnchors: true,
  }
  const proposal = new HighDensityForceImproveSolver(baseParams)
  proposal.solve()
  const proposedRoute = proposal
    .getOutput()
    .find((route) => route.connectionName === "source_net_114_mst1")!
  const proposedGap = getSquarePadEdgeGap(
    proposedRoute.vias[0]!,
    proposedRoute.viaDiameter,
    foreignBgaPad,
  )
  expect(proposedGap).toBeLessThan(0.1)

  const foreignPadParams = {
    ...structuredClone(baseParams),
    inputSrj: { ...fixture.inputSrj, obstacles: [foreignBgaPad] },
  }
  const serialSolver = new Pipeline9HighDensityForceImproveSolver(
    structuredClone(foreignPadParams),
  )
  serialSolver.solve()
  expect(serialSolver.solved).toBeTrue()
  expect(serialSolver.failed).toBeFalse()
  expect(serialSolver.getOutput()).toEqual(hdRoutes)

  const runtime = createPipeline9TestRuntime(2)
  try {
    const workerSolver = new Pipeline9HighDensityForceImproveSolver(
      structuredClone(foreignPadParams),
    )
    await workerSolver.solveAsync(runtime)
    expect(workerSolver.solved).toBeTrue()
    expect(workerSolver.getOutput()).toEqual(hdRoutes)
  } finally {
    await runtime.dispose()
  }

  const rawObstacleSolver = new Pipeline9HighDensityForceImproveSolver({
    ...structuredClone(baseParams),
    inputSrj: {
      ...fixture.inputSrj,
      obstacles: [
        {
          type: "rect" as const,
          center: foreignBgaPad.center,
          width: foreignBgaPad.width,
          height: foreignBgaPad.height,
          layers: foreignBgaPad.layers,
          connectedTo: ["pcb_smtpad_raw_foreign", "foreign_bga_net"],
        },
      ],
    },
  })
  rawObstacleSolver.solve()
  expect(rawObstacleSolver.solved).toBeTrue()
  expect(rawObstacleSolver.getOutput()).toEqual(hdRoutes)

  const sameNetPadParams = {
    ...structuredClone(baseParams),
    inputSrj: {
      ...fixture.inputSrj,
      obstacles: [
        {
          ...foreignBgaPad,
          connectedTo: ["pcb_smtpad_same_net_bga", "source_net_114_mst1"],
          circuitJsonMetadata: {
            pcb_smtpad_id: "pcb_smtpad_same_net_bga",
          },
        },
      ],
    },
  }
  const sameNetSolver = new Pipeline9HighDensityForceImproveSolver(
    sameNetPadParams,
  )
  sameNetSolver.solve()
  expect(sameNetSolver.solved).toBeTrue()
  expect(sameNetSolver.getOutput()).toEqual(proposal.getOutput())
})
