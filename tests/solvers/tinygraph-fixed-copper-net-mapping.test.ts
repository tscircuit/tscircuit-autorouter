import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { createTinyGraphFixedCopperClearanceContext } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyGraphFixedCopperClearanceContext"
import { getTinyGraphFixedCopperPortReservations } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getTinyGraphFixedCopperPortReservations"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { createPhysicalReservationProblem } from "../fixtures/tinygraph/createPhysicalReservationProblem"

test("physical reservation context derives native net IDs from loaded metadata and rejects ambiguous ownership", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [],
    layerCount: 2,
    minClearance: 0.05,
  })
  for (const nativeIds of [[7, 11], [11, 7]]) {
    const { topology, problem } = createPhysicalReservationProblem()
    problem.routeNet = new Int32Array(nativeIds)
    const context = createTinyGraphFixedCopperClearanceContext({
      problem,
      clearanceIndex: index,
      traceWidth: 0.1,
    })
    expect(context.netIdByCanonicalNetId.get("net-a")).toBe(nativeIds[0])
    expect(context.netIdByCanonicalNetId.get("net-b")).toBe(nativeIds[1])
    expect((): void => {
      new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(
        topology,
        structuredClone(problem),
        undefined,
        context,
      )
    }).toThrow("must match the loaded problem")
  }
  for (const ambiguity of [
    "one-number-two-nets",
    "one-net-two-numbers",
    "missing-owner",
  ]) {
    const { problem } = createPhysicalReservationProblem()
    if (ambiguity === "one-number-two-nets") {
      problem.routeNet[1] = problem.routeNet[0]!
    } else {
      problem.routeMetadata![1] = {
        connectionId: "route-b",
        mutuallyConnectedNetworkId:
          ambiguity === "missing-owner" ? "" : "net-a",
      }
    }
    expect((): void => {
      createTinyGraphFixedCopperClearanceContext({
        problem,
        clearanceIndex: index,
        traceWidth: 0.1,
      })
    }).toThrow("TinyGraph fixed copper")
  }
  const multipleOwners = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        zLayers: [0],
        ownerNetIds: new Set(["net-a", "net-b"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.05,
  })
  for (const includeThirdNet of [false, true]) {
    const { topology, problem } = createPhysicalReservationProblem()
    if (includeThirdNet) {
      problem.routeCount = 3
      problem.routeNet = new Int32Array([7, 11, 15])
      problem.routeStartPort = new Int32Array([0, 4, 5])
      problem.routeEndPort = new Int32Array([2, 4, 5])
      problem.routeMetadata!.push({
        connectionId: "route-c",
        mutuallyConnectedNetworkId: "net-c",
      })
    }
    const context = createTinyGraphFixedCopperClearanceContext({
      problem,
      clearanceIndex: multipleOwners,
      traceWidth: 0.1,
    })
    if (includeThirdNet) {
      expect((): Int32Array =>
        getTinyGraphFixedCopperPortReservations({ topology, context }),
      ).toThrow("cannot represent the allowed net set")
    } else {
      expect(
        getTinyGraphFixedCopperPortReservations({ topology, context })[1],
      ).toBe(-1)
    }
  }
})
