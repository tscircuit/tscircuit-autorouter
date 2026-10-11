// Only explicit named phases run; the board sets routeRemaining={false}.
export default {
  platformConfig: {
    // Use the saved footprints; provisional passives must not be silently sourced.
    partsEngineDisabled: true,
  },
  build: { routingDisabled: false },
}
