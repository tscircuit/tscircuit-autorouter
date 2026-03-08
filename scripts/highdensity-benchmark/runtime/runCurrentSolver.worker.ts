import { HighDensitySolver } from "lib/index"
import { getProblemInput } from "../dataset/getProblemInput.ts"

self.onmessage = async (event: MessageEvent<{ fileName: string }>) => {
  const { fileName } = event.data
  const startTime = performance.now()

  try {
    const input = await getProblemInput(fileName)
    if (!input) {
      self.postMessage({
        fileName,
        didSolve: false,
        timeSeconds: (performance.now() - startTime) / 1000,
        error: "problem file not found",
      })
      return
    }

    const solver = new HighDensitySolver({ nodePortPoints: [input] })
    solver.solve()

    self.postMessage({
      fileName,
      didSolve: Boolean(solver.solved),
      timeSeconds: (performance.now() - startTime) / 1000,
    })
  } catch (error) {
    self.postMessage({
      fileName,
      didSolve: false,
      timeSeconds: (performance.now() - startTime) / 1000,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
