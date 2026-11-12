// As a PCB designer, I want A -> B -> C to keep its written order,
// even when a tap shares A and the shortest tree would skip A -> B.
import { test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { checkOrderedTracePointPairs } from "../fixtures/check-ordered-trace-point-pairs"

test.failing(
  "NetToPointPairsSolver links trace path points in order",
  (): void => {
    checkOrderedTracePointPairs(NetToPointPairsSolver)
  },
)
