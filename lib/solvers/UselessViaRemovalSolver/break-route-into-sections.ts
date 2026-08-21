import type { HighDensityRoute } from "lib/types/high-density-types";
import type { RouteSection } from "./route-section";

export const breakRouteIntoSections = (
  route: HighDensityRoute,
): RouteSection[] => {
  const routeSections: RouteSection[] = [];
  const routePoints = route.route;
  if (routePoints.length === 0) return [];

  let currentSection: RouteSection = {
    startIndex: 0,
    endIndex: -1,
    z: routePoints[0].z,
    points: [routePoints[0]],
  };
  for (let i = 1; i < routePoints.length; i++) {
    if (routePoints[i].z === currentSection.z) {
      currentSection.points.push(routePoints[i]);
    } else {
      currentSection.endIndex = i - 1;
      routeSections.push(currentSection);
      currentSection = {
        startIndex: i,
        endIndex: -1,
        z: routePoints[i].z,
        points: [routePoints[i]],
      };
    }
  }
  currentSection.endIndex = routePoints.length - 1;
  routeSections.push(currentSection);

  return routeSections;
};
