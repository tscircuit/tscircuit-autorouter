import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { createPhysicalWrapperProblem } from "../fixtures/tinygraph/createPhysicalWrapperProblem"

type SolveGraphConstructorParams = ConstructorParameters<
  typeof SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments
>

test("ordinary and density-configured native loads compile fresh physical contexts at final port coordinates", (): void => {
  for (const traceDensityCost of [0, 1]) {
    const wrapper = new TinyHypergraphPortPointPathingSolver({
      ...createPhysicalWrapperProblem(),
      physicalClearance: {
        clearanceIndex: new FixedCopperClearanceIndex({
          rectangles: [
            {
              kind: "fixed-rectangle",
              center: { x: -1, y: 0 },
              width: 0.2,
              height: 0.2,
              zLayers: [0],
              ownerNetIds: new Set(["foreign-pad-net"]),
            },
          ],
          layerCount: 1,
          minClearance: 0.05,
        }),
        traceWidth: 0.1,
      },
    })
    const pipeline = wrapper["tinyPipelineSolver"]
    pipeline.inputProblem.solveGraphOptions = {
      ...pipeline.inputProblem.solveGraphOptions,
      TRACE_DENSITY_COST_FACTOR: traceDensityCost,
    }
    const stage = pipeline.pipelineDef.find(
      (step): boolean => step.solverName === "solveGraph",
    )
    if (!stage) throw new Error("Fixture is missing its native solveGraph stage")
    expect(stage.solverClass).toBe(
      SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments,
    )
    const first = stage.getConstructorParams(
      pipeline,
    ) as SolveGraphConstructorParams
    expect(first).toHaveLength(4)
    expect(first[3]?.loadedProblem).toBe(first[1])
    expect(first[2]?.TRACE_DENSITY_COST_FACTOR).toBe(traceDensityCost)
    const firstSolver =
      new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(
        ...first,
      )
    const firstPortId = first[0].portX.findIndex(
      (x, portId): boolean => x === -1 && first[0].portY[portId] === 0.6,
    )
    expect(firstPortId).toBeGreaterThanOrEqual(0)
    expect(
      firstSolver.problemSetup.portEndpointReservationNetId[firstPortId],
    ).toBe(-1)

    // A final loaded graph can contain a relocated duplicate or replacement.
    const movedPort = pipeline.inputProblem.serializedHyperGraph.ports.find(
      (port): boolean => port.portId === "edge-0-y-0.6::0",
    )
    if (!movedPort) throw new Error("Fixture is missing its movable portal")
    movedPort.d = { ...movedPort.d, y: 0 }
    const second = stage.getConstructorParams(
      pipeline,
    ) as SolveGraphConstructorParams
    expect(second).toHaveLength(4)
    expect(second[1]).not.toBe(first[1])
    expect(second[3]).not.toBe(first[3])
    expect(second[3]?.loadedProblem).toBe(second[1])
    const secondSolver =
      new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(
        ...second,
      )
    expect(
      secondSolver.problemSetup.portEndpointReservationNetId[firstPortId],
    ).toBe(-2)
    expect(
      firstSolver.problemSetup.portEndpointReservationNetId[firstPortId],
    ).toBe(-1)
  }
})
