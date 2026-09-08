import { expect, test } from "bun:test"
import { getT113BootRoutingPcbSvg } from "../fixtures/getT113BootRoutingPcbSvg"
import { getT113BootRoutingResult } from "../fixtures/getT113BootRoutingResult"

test("Pipeline9 routes real T113-S3 SD connections around a boot fanout", async () => {
  const { circuitJson, srj, preloadedTraces, sdInput, sdSolver } =
    await getT113BootRoutingResult()
  expect(
    circuitJson
      .filter((element) => element.type === "source_component")
      .map((component) => component.name),
  ).toEqual([
    "U_SOC",
    "R_BOOT_SEL1",
    "R_SD0",
    "R_SD1",
    "R_SD2",
    "R_SD3",
    "R_SD4",
  ])
  expect(srj.obstacles).toHaveLength(141)
  expect(srj.connections).toHaveLength(7)
  expect(sdInput.connections).toHaveLength(5)
  for (const connection of sdInput.connections) {
    expect(connection.pointsToConnect).toHaveLength(2)
    expect(connection.pointsToConnect[0]).toMatchObject({
      port_selector: expect.stringMatching(/^U_SOC\./),
    })
    expect(connection.pointsToConnect[1]).toMatchObject({
      port_selector: expect.stringMatching(/^R_SD/),
    })
  }
  expect(
    circuitJson.filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    ),
  ).toEqual([])
  expect(circuitJson).toContainEqual(
    expect.objectContaining({
      type: "pcb_copper_pour",
      layer: "bottom",
    }),
  )
  expect(preloadedTraces).toHaveLength(2)
  expect(sdInput.traces).toEqual(preloadedTraces)

  // The repro commit records the real failure. The stacked fix completes it.
  expect(sdSolver.solved).toBeFalse()
  expect(sdSolver.failed).toBeTrue()
  expect(sdSolver.error).toContain(
    "regional route output failed its candidate validator",
  )
  expect(
    getT113BootRoutingPcbSvg({
      circuitJson,
      srj,
      traces: preloadedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
