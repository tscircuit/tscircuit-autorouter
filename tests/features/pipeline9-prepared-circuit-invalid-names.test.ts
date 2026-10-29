import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { createPreparedRepairCircuitJsonConverter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreparedRepairCircuitJsonConverter"
import { createPreparedRepairCircuitInput, createPreparedRepairCircuitStats } from "../fixtures/prepared-repair-circuit-input"

test("prepared first-match indexes retain native strict equality for duplicate and malformed runtime names", (): void => {
  for (const badName of [NaN, undefined, null, 0, -0, false, "", "__proto__"]) {
    const { srj, traces } = createPreparedRepairCircuitInput(0)
    srj.connections[0]!.name = badName as unknown as string
    traces[0]!.connection_name = badName as unknown as string
    const options = { includeOriginalConnections: true }
    const outcome = (operation: () => unknown): unknown => {
      try { return { value: operation() } } catch (error) {
        return { errorName: (error as Error).name, error: (error as Error).message }
      }
    }
    const expected = outcome(() => convertToCircuitJson(srj, traces, options))
    expect(outcome(() => createPreparedRepairCircuitJsonConverter(srj, options, createPreparedRepairCircuitStats())(traces))).toEqual(expected)
  }
})
