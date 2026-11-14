// As a PCB designer, I want A -> B -> C to keep its written order,
// even when a tap shares A and the shortest tree would skip A -> B.
import { test } from "bun:test"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { checkOrderedTracePointPairs } from "../fixtures/check-ordered-trace-point-pairs"

test("NetToPointPairsSolver2_OffBoardConnection links trace path points in order", (): void => {
  checkOrderedTracePointPairs(NetToPointPairsSolver2_OffBoardConnection)
})
