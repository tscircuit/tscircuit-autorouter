import { expect, test } from "bun:test"
import {
  loadScenarioBySampleNumber,
  loadScenarios,
  parseDatasetName,
} from "../scripts/benchmark/scenarios"

test("SRJ37 loads the power trace boards in sample order", async (): Promise<void> => {
  expect(parseDatasetName("37")).toBe("srj37")
  expect(parseDatasetName("dataset-srj37-power-trace-boards")).toBe("srj37")
  const scenarios = await loadScenarios("srj37")
  expect(scenarios.map(([name, input]) => [name, input.layerCount])).toEqual([
    ["sample001", 4],
    ["sample002", 4],
    ["sample003", 2],
    ["sample004", 4],
    ["sample005", 4],
    ["sample006", 6],
    ["sample007", 2],
    ["sample008", 4],
    ["sample009", 4],
    ["sample010", 4],
  ])
  expect(scenarios[2]![1].traces).toHaveLength(5)
  expect(scenarios[8]![1].traces).toHaveLength(342)
  expect(scenarios[9]![1].traces).toHaveLength(638)

  const first = await loadScenarioBySampleNumber("srj37", 1)
  expect(first.sourceLabel).toBe("srj37#1:sample001")
  const v3v3 = first.scenario.connections.find(
    ({ name }) => name === "source_net_1",
  )
  expect(v3v3?.nominalTraceWidth).toBe(0.3)
  expect(v3v3?.pointsToConnect.map(({ pointId }) => pointId)).toEqual(
    expect.arrayContaining(["pcb_port_172", "pcb_port_179", "pcb_port_204"]),
  )
})
