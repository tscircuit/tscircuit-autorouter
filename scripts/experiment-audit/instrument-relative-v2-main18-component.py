"""Transparent tagged observations of unchanged old2109 certificate calls."""
import re

BEGIN='/* RELATIVE_MAIN18_COMPONENT_TAP_BEGIN */'
END='/* RELATIVE_MAIN18_COMPONENT_TAP_END */'


def require(value,message):
    if not value:raise ValueError(message)


def strip(value):
    return re.sub(re.escape(BEGIN)+r'[\s\S]*?'+re.escape(END),'',value)


def tagged(value):
    return BEGIN+value+END


def instrument(value):
    header='''export const relativeMain18ComponentObservations: { kind: string; values: unknown[]; context: unknown }[] = []
function relativeMain18Array<T>(kind: string, values: T[], context: unknown): T[] {
  relativeMain18ComponentObservations.push({ kind, values: structuredClone(values), context: structuredClone(context) })
  return values
}
function relativeMain18Native<T extends { errors: unknown[]; errorsWithCenters: unknown[]; locationAwareErrors: unknown[] }>(value: T): T {
  relativeMain18ComponentObservations.push({ kind: "nativeErrors", values: structuredClone(value.errors), context: {} })
  relativeMain18ComponentObservations.push({ kind: "nativeErrorsWithCenters", values: structuredClone(value.errorsWithCenters), context: {} })
  relativeMain18ComponentObservations.push({ kind: "nativeLocationAwareErrors", values: structuredClone(value.locationAwareErrors), context: {} })
  return value
}
'''
    require(value.count('type RawPoint = ')==1,'Raw type insertion site differs')
    value=value.replace('type RawPoint = ',tagged(header)+'type RawPoint = ')
    for function,kind,context in [('getFixedObstacleViolations','fixedObstacles','{ routes, obstacles, stack }'),('getNewViaPadViolations','viaPadPolicy','{ routes, obstacles, stack, sites }')]:
        needle='  return '+function+'('
        require(value.count(needle)==1,'Original array predicate site differs: '+function)
        position=value.index(needle)+len('  return ')
        value=value[:position]+tagged('relativeMain18Array("'+kind+'", ')+value[position:]
        close=value.index(').length',position)
        value=value[:close+1]+tagged(', '+context+')')+value[close+1:]
    needle='  const native = evaluateRelaxedDrc('
    require(value.count(needle)==1,'Native predicate site differs')
    position=value.index(needle)+len('  const native = ')
    value=value[:position]+tagged('relativeMain18Native(')+value[position:]
    close=' })\n  const circuitJson = native.circuitJson'
    require(value.count(close)==1,'Native predicate end differs')
    value=value.replace(close,' })'+tagged(')')+'\n  const circuitJson = native.circuitJson')
    needle='checkViasInPads(native.circuitJson)'
    require(value.count(needle)==1,'Via-in-pad site differs')
    value=value.replace(needle,tagged('relativeMain18Array("viasInPads", ')+needle+tagged(', {})'))
    needle='checkBoardEnvelope(original, traces, inventory.sites)'
    require(value.count(needle)==1,'Board envelope site differs')
    value=value.replace(needle,tagged('relativeMain18Array("boardReasons", ')+needle+tagged(', {})'))
    return value
