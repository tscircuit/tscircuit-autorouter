import { expect, test } from "bun:test"
import { parseFreeroutingSession } from "../../../scripts/benchmark/fixed-input/freeroutingAdapter"
import { scoreRouting } from "../../../scripts/benchmark/fixed-input/scoreRouting"
import { routingFixture } from "./routingFixture"

test("recorded Freerouting 2.4.1 sessions preserve surface and plated-pad connectivity", async () => {
  // These SES files were produced from createFreeroutingDsn(routingFixture())
  // by the pinned 2.4.1 JAR, Java 25, max_passes=4, with fanout, optimizer and
  // automatic_neckdown disabled. The second input adds the through pad below.
  // They are interoperability fixtures, not benchmark timing measurements.
  const srj = routingFixture()
  const viaSession = await Bun.file(
    new URL("./freeroutingVia.ses", import.meta.url),
  ).text()
  expect(
    scoreRouting(srj, parseFreeroutingSession(viaSession, srj)),
  ).toMatchObject({ valid: true, connectedConnections: 1, viaCount: 1 })
  srj.obstacles.push({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layers: ["top", "bottom"],
    connectedTo: ["signal"],
  })
  srj.connections[0].pointsToConnect.push({
    x: 0,
    y: 0,
    layers: ["top", "bottom"],
  })
  const throughSession = await Bun.file(
    new URL("./freeroutingThroughPad.ses", import.meta.url),
  ).text()
  expect(
    scoreRouting(srj, parseFreeroutingSession(throughSession, srj)),
  ).toMatchObject({
    valid: true,
    connectedConnections: 1,
    viaCount: 0,
    traceLengthMm: 6,
  })
})
