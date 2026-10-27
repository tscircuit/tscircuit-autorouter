import { expect, test } from "bun:test"
import { captureFailedHdrInput } from "../../scripts/benchmark/capture-failed-hdr"

test("opt-in HDR capture isolates I/O and serialization failures from routing", async () => {
  const header = { solverName: "pipeline9", scenarioName: "sample024", sampleNumber: 24 }
  const source = { params: { nodePortPoints: [] }, solved: false, failed: true, iterations: 17 }
  const messages: string[] = [], files: [string, string][] = []
  await captureFailedHdrInput({ header, source }, () => { throw new Error("disabled capture must not write") })
  await captureFailedHdrInput({ directory: "/tmp/hdr", header, source }, (path, data) => { files.push([path, data]) }, (m) => messages.push(m))
  expect(files.length).toBe(1)
  expect(files[0][0]).toBe("/tmp/hdr/pipeline9-sample024.hdr.json")
  expect(JSON.parse(files[0][1]).retainedConstructorNodeCount).toBe(0)
  await captureFailedHdrInput({ directory: "/tmp/hdr", header, source }, () => { throw new Error("disk unavailable") }, (m) => messages.push(m))
  await captureFailedHdrInput({ directory: "/tmp/hdr", header, source }, () => { throw new Error("disk unavailable") }, () => { throw new Error("diagnostic logger unavailable") })
  const cyclic = { nodePortPoints: [], self: null as unknown }; cyclic.self = cyclic
  await captureFailedHdrInput({ directory: "/tmp/hdr", header, source: { params: cyclic } }, () => { throw new Error("must not write cyclic data") }, (m) => messages.push(m))
  expect(messages.some((m) => m.includes("disk unavailable"))).toBe(true)
  expect(messages.some((m) => m.includes("capture unavailable"))).toBe(true)
  expect(source).toEqual({ params: { nodePortPoints: [] }, solved: false, failed: true, iterations: 17 })
})
