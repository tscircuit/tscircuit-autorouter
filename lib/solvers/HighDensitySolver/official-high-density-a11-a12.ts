import * as officialA11A12Package from "@tscircuit/high-density-a01-a11-a12"

// The legacy and official pins declare the same package name and version, so
// TypeScript merges their package identities. Resolve the distinct runtime pin
// here while keeping legacy A01/A03 on their known-good commit.
const officialSolvers = officialA11A12Package as unknown as Record<
  string,
  new (props: any) => any
>

export const HighDensitySolverA11 = officialSolvers.HighDensitySolverA11!
export const HighDensitySolverA12 = officialSolvers.HighDensitySolverA12!
