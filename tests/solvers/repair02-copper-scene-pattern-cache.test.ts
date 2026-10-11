import { expect, test } from "bun:test"
import { RouteCopperScenePatternCache } from "high-density-repair02/lib/high-density-repair-solver/functions/repairNodeClearance"
import type { HdRoute } from "high-density-repair02/lib/high-density-repair-solver/shared/types"

type Copper = {
  start: { x: number; y: number }
  end: { x: number; y: number }
  radius: number
}

test("cached copper scenes retain every exact broadphase pair in original order", () => {
  const cache = new RouteCopperScenePatternCache()
  let seed = 9387193
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (const scale of [1e-9, 1, 1e9]) {
    for (let run = 0; run < 40; run++) {
      const routes = Array.from({ length: 4 }, (_, i) => ({
        connectionName: `net${i}`,
        route: [],
        vias: [],
      })) as HdRoute[]
      const fixedRoutes: HdRoute[] = []
      const clearance = scale * 0.1
      const geometries: Copper[][] = routes.map(() =>
        Array.from({ length: 24 }, () => {
          const x = (random() - 0.5) * scale * 10
          const y = (random() - 0.5) * scale * 10
          return {
            start: { x, y },
            end: {
              x: x + (random() - 0.5) * scale,
              y: y + (random() - 0.5) * scale,
            },
            radius: random() * scale * 0.2,
          }
        }),
      )
      const changedRoute = run % 4
      for (let sweep = 0; sweep < 4; sweep++) {
        const changed = geometries[changedRoute]!
        const anchor = changed[0]!
        const radius = scale * 0.1
        for (let otherRoute = 0; otherRoute < routes.length; otherRoute++) {
          if (otherRoute === changedRoute) continue
          if (sweep === 0) {
            // Axis contact, plus adjacent representable values on either side.
            const contact = anchor.start.x + clearance + anchor.radius + radius
            for (let i = 0; i < 3; i++) {
              const x = contact + (i - 1) * Math.abs(contact) * Number.EPSILON
              geometries[otherRoute]![i] = {
                start: { x, y: anchor.start.y },
                end: { x, y: anchor.start.y },
                radius,
              }
            }
          }
        }
        const pairs = cache.getCandidatePairs(
          routes,
          fixedRoutes,
          changedRoute,
          geometries,
          clearance,
        )!
        expect(pairs).toBeDefined()
        for (let otherRoute = 0; otherRoute < routes.length; otherRoute++) {
          if (otherRoute === changedRoute) continue
          const firstRoute = Math.min(changedRoute, otherRoute)
          const secondRoute = Math.max(changedRoute, otherRoute)
          const firstCopper = geometries[firstRoute]!
          const secondCopper = geometries[secondRoute]!
          const found = pairs.get(otherRoute)
          for (
            let firstIndex = 0;
            firstIndex < firstCopper.length;
            firstIndex++
          ) {
            const candidateIndexes = found?.[firstIndex] ?? []
            expect(candidateIndexes).toEqual(
              [...new Set(candidateIndexes)].sort((a, b) => a - b),
            )
            for (
              let secondIndex = 0;
              secondIndex < secondCopper.length;
              secondIndex++
            ) {
              const first = firstCopper[firstIndex]!
              const second = secondCopper[secondIndex]!
              const required = clearance + first.radius + second.radius
              if (
                Math.min(first.start.x, first.end.x) >
                  Math.max(second.start.x, second.end.x) + required ||
                Math.min(second.start.x, second.end.x) >
                  Math.max(first.start.x, first.end.x) + required ||
                Math.min(first.start.y, first.end.y) >
                  Math.max(second.start.y, second.end.y) + required ||
                Math.min(second.start.y, second.end.y) >
                  Math.max(first.start.y, first.end.y) + required
              )
                continue
              expect(candidateIndexes).toContain(secondIndex)
            }
          }
        }
        // Replace only the changed route, while reusing the unchanged scene.
        geometries[changedRoute] = changed.map((copper) => ({
          ...copper,
          start: { x: copper.start.x + scale * 0.001, y: copper.start.y },
          end: { x: copper.end.x + scale * 0.001, y: copper.end.y },
        }))
      }
      const anchor = geometries[changedRoute]![0]!
      const fixedCopper: Copper = {
        start: { ...anchor.start },
        end: { ...anchor.end },
        radius: anchor.radius,
      }
      const fixedRoute = {
        connectionName: "fixed",
        route: [],
        vias: [],
      } as HdRoute
      geometries.push([fixedCopper])
      const withFixed = cache.getCandidatePairs(
        routes,
        [fixedRoute],
        changedRoute,
        geometries,
        clearance,
      )!
      expect(withFixed.get(4)?.[0]).toContain(0)
      geometries[4] = [
        {
          ...fixedCopper,
          start: { x: anchor.start.x + 100 * scale, y: anchor.start.y },
          end: { x: anchor.end.x + 100 * scale, y: anchor.end.y },
        },
      ]
      // Replacing the fixed-route array invalidates this board's scene.
      const replacedFixed = cache.getCandidatePairs(
        routes,
        [{ ...fixedRoute }],
        changedRoute,
        geometries,
        clearance,
      )!
      expect(replacedFixed.get(4)?.[0] ?? []).not.toContain(0)
      geometries[4] = [fixedCopper]
      // Acceptance replaces the current array, while fixed routes retain identity.
      const stableFixed = [{ ...fixedRoute }]
      const beforeAcceptance = cache.getCandidatePairs(
        routes,
        stableFixed,
        changedRoute,
        geometries,
        clearance,
      )!
      expect(beforeAcceptance.get(4)?.[0]).toContain(0)
      geometries[4] = [
        {
          ...fixedCopper,
          start: { x: anchor.start.x + 100 * scale, y: anchor.start.y },
          end: { x: anchor.end.x + 100 * scale, y: anchor.end.y },
        },
      ]
      const afterAcceptance = cache.getCandidatePairs(
        [...routes],
        stableFixed,
        changedRoute,
        geometries,
        clearance,
      )!
      expect(afterAcceptance.get(4)?.[0] ?? []).not.toContain(0)
    }
  }
})
