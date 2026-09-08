import { expect, test } from "bun:test"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { PortPoint } from "lib/types/high-density-types"
import { createPipeline9RegionalPhysicalProblem } from "../fixtures/pipeline9RegionalPhysicalClearance"

test("regional physical inputs fail named for unresolved nets and partially covered explicit pairs", (): void => {
  const fixture = createPipeline9RegionalPhysicalProblem()
  for (const identity of [
    { connectionName: "missing-route", rootConnectionName: "missing-root" },
    { connectionName: "target-source", rootConnectionName: "foreign-root" },
  ]) {
    const points: [PortPoint, PortPoint] = [
      { ...fixture.pair[0], ...identity },
      { ...fixture.pair[1], ...identity },
    ]
    expect((): void => {
      new Pipeline9RegionalFallbackSolver({
        ...fixture.params,
        nodeWithPortPoints: {
          ...fixture.node,
          portPoints: points,
          portPointsInPairs: [points],
        },
      })
    }).toThrow("requires one known electrical net")
  }
  const uncovered: PortPoint = {
    ...fixture.pair[0],
    x: 2,
    y: -4,
    portPointId: "uncovered-source-port",
    pcb_port_id: "uncovered-source-terminal",
  }
  const node = {
    ...fixture.node,
    portPoints: [...fixture.node.portPoints, uncovered],
  }
  const solver = new Pipeline9RegionalFallbackSolver({
    ...fixture.params,
    nodeWithPortPoints: node,
  })
  const context = solver.highDensitySolver.physicalClearanceContext
  if (!context)
    throw new Error("Expected physical input before pair validation")
  expect((): void => {
    new IntraNodeRouteSolver({
      ...fixture.params,
      nodeWithPortPoints: node,
      physicalClearanceContext: context,
    })
  }).toThrow(
    'Physical intra-node pairs for "regional-physical-node" leave a node port without a routing obligation',
  )
  expect(solver.forceImproveSolver).toBeUndefined()
})
