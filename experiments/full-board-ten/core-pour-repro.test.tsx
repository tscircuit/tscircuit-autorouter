import { expect, test } from "bun:test"
import { TscircuitAutorouter } from "lib/utils/autorouting/CapacityMeshAutorouter"
import { getTestFixture } from "tests/fixtures/get-test-fixture"

test("reading the circuit during routing keeps pours after the routed vias", async () => {
  const { circuit } = getTestFixture()
  const releaseRouting = Promise.withResolvers<void>()
  const previewReady = Promise.withResolvers<void>()
  let viasSeenByPour = 0
  circuit.on("autorouting:start", () => {
    circuit.getCircuitJson()
  })
  circuit.on("asyncEffect:end", ({ effectName, error }) => {
    if (
      effectName === "PcbCopperPourPreviewRender" ||
      effectName === "PcbCopperPourRender"
    ) {
      if (error) previewReady.reject(new Error(error))
      else previewReady.resolve()
    }
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
      autorouter={{
        algorithmFn: async (input) => {
          await releaseRouting.promise
          return new TscircuitAutorouter(input)
        },
      }}
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
      <pcbnotetext text="GND plane" fontSize={0.6} pcbY={3} />
      <pcbnotetext text="Signal via" fontSize={0.5} pcbX={3} pcbY={-1.6} />
    </board>,
  )

  const rendering = circuit.renderUntilSettled()
  void rendering.catch(previewReady.reject)
  try {
    await previewReady.promise
    expect(circuit.isDoneRendering()).toBeFalse()
    expect(circuit.db.pcb_trace.list()).toHaveLength(0)
    expect(circuit.db.pcb_via.list()).toHaveLength(1)
    expect(circuit.db.pcb_copper_pour.list()).toHaveLength(1)
  } finally {
    releaseRouting.resolve()
    await rendering
  }

  expect(circuit.db.pcb_trace.list()).toHaveLength(1)
  expect(circuit.db.pcb_via.list()).toHaveLength(2)
  expect(viasSeenByPour).toBe(circuit.db.pcb_via.list().length)
  await expect(circuit.getCircuitJson()).toMatchPcbSnapshot(import.meta.path, {
    layer: "inner1",
    showPcbNotes: true,
  })
})
