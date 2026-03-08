import { readdir } from "node:fs/promises"
import { problemsDir } from "../config/paths.ts"

export const getAllProblemFileNames = async () => {
  return (await readdir(problemsDir))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort(
      (left, right) => Number(left.slice(0, -5)) - Number(right.slice(0, -5)),
    )
}
