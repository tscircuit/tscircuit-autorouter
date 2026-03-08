import { join } from "node:path"
import { problemsDir } from "../config/paths.ts"

export const getProblemPath = (fileName: string) => join(problemsDir, fileName)
