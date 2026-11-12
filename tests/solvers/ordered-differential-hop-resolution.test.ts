// As a PCB designer, I want recorded lane hops to survive missing endpoint IDs
// and reject missing output while legacy single-hop pairs retain coupling.
import { test } from "bun:test"
import { checkOrderedDifferentialHopResolution } from "../fixtures/check-ordered-differential-hop-resolution"

test("recorded lane hops survive missing endpoint IDs and reject missing output; legacy single hops keep coupling", (): void => {
  checkOrderedDifferentialHopResolution()
})
