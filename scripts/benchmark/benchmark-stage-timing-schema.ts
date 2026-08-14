import { z } from "zod"
import type { BenchmarkStageTimingBreakdown } from "./benchmark-types"

const benchmarkStageTimingSchema = z
  .object({
    status: z.enum(["complete", "partial"]),
    stages: z.array(
      z.object({
        stageName: z.string().refine((name) => name.trim() !== ""),
        elapsedTimeMs: z.number().finite().nonnegative(),
      }),
    ),
  })
  .superRefine(({ stages }, context) => {
    const stageNames = new Set<string>()
    stages.forEach(({ stageName }, index) => {
      if (stageNames.has(stageName)) {
        context.addIssue({
          code: "custom",
          path: ["stages", index, "stageName"],
          message: `Duplicate stageTiming stage ${stageName}`,
        })
      }
      stageNames.add(stageName)
    })
  }) satisfies z.ZodType<BenchmarkStageTimingBreakdown>

export const parseBenchmarkStageTimingOrThrow = (
  value: unknown,
  sourceLabel: string,
): BenchmarkStageTimingBreakdown => {
  const result = benchmarkStageTimingSchema.safeParse(value)
  if (result.success) return result.data

  const duplicateIssue = result.error.issues.find((issue) =>
    issue.message.startsWith("Duplicate stageTiming stage "),
  )
  if (duplicateIssue) {
    throw new Error(`${duplicateIssue.message} in ${sourceLabel}`)
  }

  const invalidStageIssue = result.error.issues.find(
    (issue) =>
      issue.path[0] === "stages" && typeof issue.path[1] === "number",
  )
  const invalidStageIndex = invalidStageIssue?.path[1]
  if (typeof invalidStageIndex === "number") {
    throw new Error(
      `Invalid stageTiming stage ${invalidStageIndex} in ${sourceLabel}`,
    )
  }
  throw new Error(`Invalid stageTiming in ${sourceLabel}`)
}
