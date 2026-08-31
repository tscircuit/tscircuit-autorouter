import {
  // @ts-expect-error The legacy pin masks exports from this exact-commit alias.
  HighDensitySolverA11 as OfficialHighDensitySolverA11,
  // @ts-expect-error The legacy pin masks exports from this exact-commit alias.
  HighDensitySolverA12 as OfficialHighDensitySolverA12,
} from "@tscircuit/high-density-a01-a11-a12"

// Both pins declare the same upstream package name and version, so TypeScript
// merges their identities. Resolve the distinct A11/A12 runtime pin here while
// keeping legacy A01/A03 on their known-good commit.
type OfficialSolverConstructor = new (props: any) => any

export const HighDensitySolverA11 =
  OfficialHighDensitySolverA11 as unknown as OfficialSolverConstructor

export const HighDensitySolverA12 =
  OfficialHighDensitySolverA12 as unknown as OfficialSolverConstructor
