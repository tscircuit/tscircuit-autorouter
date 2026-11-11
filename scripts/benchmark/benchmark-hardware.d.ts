export type BenchmarkHardware = {
  key: string
  label: string
}

export function getBenchmarkHardware(runtime: unknown): BenchmarkHardware | null
