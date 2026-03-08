import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getProblemPath } from "./getProblemPath.ts"

export const getProblemInput = async (
  fileName: string,
): Promise<NodeWithPortPoints | null> => {
  const problemFile = Bun.file(getProblemPath(fileName))

  // Some cached result sets can outlive individual problem files, so skip safely.
  if (!(await problemFile.exists())) {
    return null
  }

  return (await problemFile.json()) as NodeWithPortPoints
}
