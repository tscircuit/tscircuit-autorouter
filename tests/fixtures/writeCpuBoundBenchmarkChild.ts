import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

export const writeCpuBoundBenchmarkChild = async (
  directory: string,
): Promise<void> => {
  await mkdir(join(directory, "scripts/benchmark"), { recursive: true })
  await writeFile(
    join(directory, "scripts/benchmark/benchmark.child.ts"),
    `const taskId = 1
const task = { solverName: "test", scenarioName: "cpu-bound", sampleNumber: 1 }
  process.stdout.write(JSON.stringify({ taskId, progress: {
    solverName: task.solverName, scenarioName: task.scenarioName,
    sampleNumber: task.sampleNumber, elapsedTimeMs: 0, peakRssBytes: 1,
  } }) + "\\n")
  const bytes = new Uint8Array(192 * 1024 * 1024)
  bytes.fill(1)
  globalThis.retainedMemory = bytes
  let index = 0
  while (true) index = (index + bytes[index]) % bytes.length
`,
  )
}
