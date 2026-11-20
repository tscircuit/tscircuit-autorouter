import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { FanoutSolver } from "@tscircuit/fanout-solver"
import {
  checkEachPcbTraceNonOverlapping,
  checkHoleTraceClearance,
  checkPadTraceClearance,
} from "@tscircuit/checks"
import { getTestFixture } from "tests/fixtures/get-test-fixture"

test("flexible fanout buses share capacity with fixed-top controls", async () => {
  const { circuit } = getTestFixture()
  const fanoutStep = FanoutSolver.prototype.step
  FanoutSolver.prototype.step = function () {
    try { return fanoutStep.call(this) }
    finally {
      if (this.solved || this.failed) writeFileSync("native-fanout.json.gz", Bun.gzipSync(JSON.stringify({ input: this.getConstructorParams(), bestAttempt: this.bestAttempt, failed: this.failed, error: this.error })))
    }
  }
  const phases: { event: string; phase: string; solver: string | undefined; connections: number | undefined }[] = []
  for (const event of ["autorouting:start", "autorouting:end", "autorouting:error"] as const) {
    circuit.on(event, (entry) => phases.push({ event, phase: entry.phaseName ?? entry.componentDisplayName, solver: entry.solverName, connections: entry.simpleRouteJson?.connections.length }))
  }
  circuit.add(
    <board
      width={24}
      height={10}
      layers={2}
      minTraceWidth={0.1}
      defaultTraceWidth={0.1}
      minTraceToPadEdgeClearance={0.1}
      minTraceToHoleEdgeClearance={0.1}
      minViaHoleDiameter={0.15}
      minViaPadDiameter={0.3}
    >
      <breakout
        name="CONTROLLER"
        pcbX={-5}
        width={6}
        height={3.6}
        fanoutRoutingLayers={["top", "bottom"]}
        busFanoutDirections={{
          DATA: "rightside_center",
          SERIAL: "rightside_center",
          CONTROL: "rightside_center",
        }}
      >
        <chip name="U1" footprint="bga9_grid3x3_p0.8mm" />
      </breakout>
      <chip name="U2" footprint="bga9_grid3x3_p0.8mm" pcbX={5} />
      <trace name="DATA0" from="U1.pin1" to="U2.pin1" />
      <trace name="DATA1" from="U1.pin2" to="U2.pin2" />
      <trace name="DATA2" from="U1.pin3" to="U2.pin3" />
      <trace name="SCLK" from="U1.pin4" to="U2.pin4" />
      <trace name="MOSI" from="U1.pin6" to="U2.pin6" />
      <trace name="MISO" from="U1.pin7" to="U2.pin7" />
      <trace name="RESET_N" from="U1.pin8" to="U2.pin8" />
      <trace name="IRQ" from="U1.pin9" to="U2.pin9" />
      <bus
        name="DATA"
        connections={["DATA0", "DATA1", "DATA2"]}
        preferredLayers={["top", "bottom"]}
      />
      <bus
        name="SERIAL"
        connections={["SCLK", "MOSI", "MISO"]}
        preferredLayers={["top", "bottom"]}
      />
      <bus
        name="CONTROL"
        connections={["RESET_N", "IRQ"]}
        preferredLayer="top"
      />
      <pcbnotetext
        text="8-signal controller link: native fanout, then global routing"
        pcbY={3.6}
        fontSize={0.3}
      />
      <pcbnotetext
        text="DATA + SERIAL: top/bottom | RESET_N + IRQ: fixed top"
        pcbY={3}
        fontSize={0.27}
      />
    </board>,
  )
  await circuit.renderUntilSettled()
  const circuitJson = circuit.getCircuitJson()
  writeFileSync("native.circuit.json.gz", Bun.gzipSync(JSON.stringify(circuitJson)))
  writeFileSync("native-phases.json", JSON.stringify(phases, null, 2))
  await expect(circuit).toMatchPcbSnapshot(import.meta.path, { backgroundColor: "white", showDebugObjects: false, showPcbGroups: true })
  expect(checkEachPcbTraceNonOverlapping(circuitJson)).toEqual([])
  expect(checkHoleTraceClearance(circuitJson)).toEqual([])
  expect(checkPadTraceClearance(circuitJson)).toEqual([])
  await expect(circuit).toMatchPcbSnapshot(import.meta.path, {
    backgroundColor: "white",
    showDebugObjects: false,
    showPcbGroups: true,
  })
}, 120_000)
