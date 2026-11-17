import { expect, test } from "bun:test"
import { getTestFixture } from "tests/fixtures/get-test-fixture"

test("reading the circuit during routing keeps pours after the routed vias", async () => {
  const { circuit } = getTestFixture()
  let viasSeenByPour = 0
  circuit.on("autorouting:start", () => {
    circuit.getCircuitJson()
  })
  circuit.on("solver:started", ({ solverName }) => {
    if (solverName === "CopperPourPipelineSolver") {
      viasSeenByPour = circuit.db.pcb_via.list().length
    }
  })

  circuit.add(
    <board
      width={12}
      height={8}
      layers={4}
      schematicDisabled
      placementDrcChecksDisabled
      autorouter="auto_local"
    >
      <resistor name="R1" resistance="1k" footprint="0402" pcbX={-3} />
      <resistor
        name="R2"
        resistance="1k"
        footprint="0402"
        pcbX={3}
        layer="bottom"
      />
      <net name="SIGNAL" connectsTo={[".R1 > .pin1", ".R2 > .pin1"]} />
      <via
        pcbX={0}
        pcbY={2}
        connectsTo="net.GND"
        fromLayer="top"
        toLayer="bottom"
        holeDiameter={0.3}
        outerDiameter={0.6}
      />
      <copperpour connectsTo="net.GND" layer="inner1" clearance={0.25} />
      <pcbnotetext text="Signal via through ground plane" pcbY={-3} />
    </board>,
  )

  await circuit.renderUntilSettled()

  await expect(circuit.getCircuitJson()).toMatchPcbSnapshot(import.meta.path, {
    layer: "inner1",
    showPcbNotes: true,
  })
  expect(circuit.db.pcb_trace.list()).toHaveLength(1)
  expect(circuit.db.pcb_via.list().length).toBeGreaterThan(1)
  expect(viasSeenByPour).toBe(circuit.db.pcb_via.list().length)
})
