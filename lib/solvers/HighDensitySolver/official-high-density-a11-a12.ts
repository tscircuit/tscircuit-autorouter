import * as officialA11A12Package from "@tscircuit/high-density-a01-a11-a12"

// Both pins declare the same upstream package name and version, so TypeScript
// merges their identities. Resolve the distinct A11/A12 runtime pin here while
// keeping legacy A01/A03 on their known-good commit.
type OfficialSolverConstructor = new (props: any) => any

export const HighDensitySolverA11 = (
  officialA11A12Package as unknown as {
    HighDensitySolverA11: OfficialSolverConstructor
  }
).HighDensitySolverA11

export const HighDensitySolverA12 = (
  officialA11A12Package as unknown as {
    HighDensitySolverA12: OfficialSolverConstructor
  }
).HighDensitySolverA12
