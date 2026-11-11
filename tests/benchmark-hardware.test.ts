import { expect, test } from "bun:test"
import { getBenchmarkHardware } from "../scripts/benchmark/benchmark-hardware.js"
import { getBenchmarkCpuModel } from "../scripts/benchmark/benchmarkRuntime"
import { createThreadComparisonReport } from "./fixtures/threadComparisonReport"

test("ARM core identifiers distinguish hardware when Bun reports unknown", () => {
  const gen1 = getBenchmarkCpuModel(
    ["unknown"],
    "CPU implementer : 0x41\nCPU architecture : 8\nCPU part : 0xd0c\nCPU variant : 0x0\nCPU revision : 1\n",
  )
  const gen2 = getBenchmarkCpuModel(
    ["unknown"],
    "CPU implementer : 0xc0\nCPU architecture : 8\nCPU part : 0xac3\nCPU variant : 0x0\nCPU revision : 1\n",
  )
  const runtime = createThreadComparisonReport(1_000, 1).runtime!
  const first = getBenchmarkHardware({ ...runtime, cpuModel: gen1 })
  const second = getBenchmarkHardware({ ...runtime, cpuModel: gen2 })
  expect(gen1).toContain("CPU implementer=0x41")
  expect(gen2).toContain("CPU implementer=0xc0")
  expect(first?.key).not.toBe(second?.key)
  expect(second?.key).toBe(
    getBenchmarkHardware({ ...runtime, cpuModel: gen2 })?.key,
  )
  expect(second?.key).not.toBe(
    getBenchmarkHardware({ ...runtime, cpuModel: gen2, workerCount: 2 })?.key,
  )
  expect(getBenchmarkHardware({ ...runtime, cpuModel: "unknown" })).toBeNull()
  expect(getBenchmarkHardware(undefined)).toBeNull()
  expect(getBenchmarkCpuModel(["AMD Ryzen"], "")).toBe("AMD Ryzen")
  expect(getBenchmarkCpuModel([], "")).toBe("unknown")
})
