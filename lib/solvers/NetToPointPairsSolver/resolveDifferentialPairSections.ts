import type { DifferentialPair, SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type ResolvedDifferentialPair = DifferentialPair & {
  minimumCenterlineDistance?: number
  maximumCenterlineDistance?: number
}

export function resolveDifferentialPairSections(
  pipelineName: string,
  pairs: DifferentialPair[],
  pointPairs: SimpleRouteConnection[],
  sectionNamesByMember: ReadonlyMap<string, string[]>,
  hdRoutes: HighDensityRoute[],
): ResolvedDifferentialPair[] {
  const resolveMember = (name: string): string[] => {
    const sectionNames = sectionNamesByMember.get(name)
    if (sectionNames) return sectionNames

    const matches = pointPairs.filter(
      (connection) =>
        connection.name === name ||
        connection.__rootConnectionNames?.includes(name) ||
        connection.__netConnectionName === name,
    )
    if (matches.length !== 1) {
      throw new Error(
        `${pipelineName}: differential pair connection "${name}" must resolve to exactly one final point-pair connection, got ${matches.length}`,
      )
    }
    return [matches[0]!.name]
  }

  return pairs.flatMap((pair) => {
    const positiveSections = resolveMember(pair.connectionNames[0])
    const negativeSections = resolveMember(pair.connectionNames[1])
    if (positiveSections.length !== negativeSections.length) {
      throw new Error(
        `${pipelineName}: differential pair ${pair.connectionNames.join("/")} resolves to different section counts`,
      )
    }

    return positiveSections.map((positiveSection, index): ResolvedDifferentialPair => {
      const negativeSection = negativeSections[index]!
      if (positiveSection === negativeSection) {
        throw new Error(
          `${pipelineName}: differential pair ${pair.connectionNames.join("/")} resolves both members to "${positiveSection}"`,
        )
      }

      const section: ResolvedDifferentialPair = {
        connectionNames: [positiveSection, negativeSection],
        // Bounding each section's skew bounds the sum along the whole path.
        lengthTolerance: pair.lengthTolerance / positiveSections.length,
      }
      if (pair.maxUncoupledLength !== undefined) {
        section.maxUncoupledLength = pair.maxUncoupledLength
      }
      if (pair.traceGap === undefined) return section

      const halfWidths = section.connectionNames.map((name) => {
        const matchingRoutes = hdRoutes.filter((route) => route.connectionName === name)
        if (matchingRoutes.length !== 1) {
          throw new Error(
            `${pipelineName}: differential pair connection "${name}" must resolve to exactly one final HD route, got ${matchingRoutes.length}`,
          )
        }
        return matchingRoutes[0]!.traceThickness / 2
      })
      const centerlineDistance = pair.traceGap + halfWidths[0]! + halfWidths[1]!
      section.minimumCenterlineDistance = centerlineDistance
      section.maximumCenterlineDistance = centerlineDistance
      return section
    })
  })
}
