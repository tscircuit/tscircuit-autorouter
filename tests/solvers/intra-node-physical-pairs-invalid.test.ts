import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { PortPoint } from "lib/types/high-density-types"
import { createIntraNodePhysicalPairProblem } from "../fixtures/intraNodePhysicalPairs"

test("physical pair inputs fail with named endpoint, coverage and electrical-identity violations", (): void => {
  const cases = [
    ["null-pairs", "require nonempty explicit pairs"],
    ["nonarray-pairs", "require nonempty explicit pairs"],
    ["null-source-ports", "require an array of source node ports"],
    ["null-source-endpoint", "contain an invalid endpoint"],
    ["malformed", "contain a malformed pair"],
    ["nonfinite", "contain an invalid endpoint"],
    ["layer", "contain an invalid endpoint"],
    ["empty-identity", "contain an invalid endpoint identity"],
    ["unwitnessed", "contain an endpoint absent from node ports"],
    ["uncovered", "leave a node port without a routing obligation"],
    ["mixed-name", "must preserve each pair's connection identity"],
    ["root", "contain a conflicting electrical identity"],
    ["missing-canonical", "require a canonical connection identity"],
    ["canonical", "contain a conflicting electrical identity"],
  ] as const
  for (const [kind, reason] of cases) {
    const { node, context, params } = createIntraNodePhysicalPairProblem()
    const firstPair = node.portPointsInPairs![0]!
    switch (kind) {
      case "null-pairs":
        node.portPointsInPairs = null as unknown as [PortPoint, PortPoint][]
        break
      case "nonarray-pairs":
        node.portPointsInPairs = {} as unknown as [PortPoint, PortPoint][]
        break
      case "null-source-ports":
        node.portPoints = null as unknown as PortPoint[]
        break
      case "null-source-endpoint":
        node.portPoints[0] = null as unknown as PortPoint
        break
      case "malformed":
        // Deliberately model an invalid runtime tuple at the typed boundary.
        node.portPointsInPairs = [
          [firstPair[0]] as unknown as [PortPoint, PortPoint],
        ]
        break
      case "nonfinite":
        firstPair[0].x = Number.NaN
        break
      case "layer":
        firstPair[0].z = 2
        break
      case "empty-identity":
        firstPair[0].portPointId = ""
        break
      case "unwitnessed":
        firstPair[0].x = -0.75
        break
      case "uncovered":
        node.portPoints.push({
          ...firstPair[0],
          x: -0.5,
          portPointId: "uncovered-port",
          pcb_port_id: "pcb-uncovered",
        })
        break
      case "mixed-name": {
        const foreignEnd: PortPoint = {
          ...firstPair[1],
          connectionName: "foreign-net",
          rootConnectionName: "foreign-root",
        }
        firstPair[1] = foreignEnd
        node.portPoints[1] = { ...foreignEnd }
        params.physicalClearanceContext = {
          ...context,
          canonicalNetIdByConnectionName: new Map([
            ...context.canonicalNetIdByConnectionName,
            ["foreign-net", "foreign-canonical"],
            ["foreign-root", "foreign-canonical"],
          ]),
        }
        break
      }
      case "root":
        firstPair[1].rootConnectionName = "undeclared-root"
        break
      case "missing-canonical":
        params.physicalClearanceContext = {
          ...context,
          canonicalNetIdByConnectionName: new Map(),
        }
        break
      case "canonical":
        params.physicalClearanceContext = {
          ...context,
          canonicalNetIdByConnectionName: new Map([
            ...context.canonicalNetIdByConnectionName,
            ["paired-net", "different-canonical"],
          ]),
        }
        break
    }
    const before = structuredClone(node)
    expect(
      (): IntraNodeRouteSolver => new IntraNodeRouteSolver(params),
    ).toThrow(`Physical intra-node pairs for "physical-pair-node" ${reason}`)
    expect(node).toEqual(before)
  }
})
