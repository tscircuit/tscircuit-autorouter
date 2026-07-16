export type PrBenchmarkCommand = {
  kind: "benchmark" | "benchmark-long" | "benchmark-all"
  benchmarkArgs: string[]
  datasetName: string
  profileSolvers: boolean
}

export function parsePrBenchmarkCommand(body: string): PrBenchmarkCommand
