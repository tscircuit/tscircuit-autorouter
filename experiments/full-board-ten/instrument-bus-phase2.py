#!/usr/bin/env python3
"""Add bounded read-only lifecycle/cost observations to one exact Core bundle.
No search, geometry predicate, routing budget or candidate ordering is changed.
"""
import argparse
import hashlib
import json
from pathlib import Path

CORE_SHA = 'a02e5e4378214bd37bb0bdb2a59ec681b0ef400a58d553038755250f08875176'
HELPERS = r'''
var __busDiagSequence = 0;
var __busDiagMetadata = { counts: Object.create(null), errors: [] };
function __busDiag(type, data) {
  try {
    __busDiagMetadata.counts[type] = (__busDiagMetadata.counts[type] ?? 0) + 1;
    globalThis.__busDiag?.(type, data);
  } catch (error) {
    if (__busDiagMetadata.errors.length < 20) __busDiagMetadata.errors.push(String(error));
  }
}
function* __busDiagDelegate(event, inner, details) {
  const call = ++__busDiagSequence, started = performance.now();
  let completed = false, yields = 0;
  __busDiag(event + ":start", {...details, call});
  const delegated = {
    [Symbol.iterator]() { return this; },
    next(value) { const step = inner.next(value); if (!step.done) yields++; return step; },
    return(value) { return inner.return(value); },
    throw(error) { return inner.throw(error); }
  };
  try {
    const result = yield* delegated;
    completed = true;
    __busDiag(event + ":return", {...details, call, yields, elapsedMs: performance.now() - started, result});
    return result;
  } finally {
    if (!completed) __busDiag(event + ":cancelled_or_threw", {...details, call, yields, elapsedMs: performance.now() - started});
  }
}
function* pendingPackageExits(input, fixed) {
  return yield* __busDiagDelegate("pending_guides", __busDiagOriginalPendingPackageExits(input, fixed), {names: input.connections.map(c => c.name)});
}
function* routeGeneratedSignalSites(request) {
  return yield* __busDiagDelegate("generated_sites", __busDiagOriginalRouteGeneratedSignalSites(request), {names: request.input.connections.map(c => c.name), maxSteps: request.maxSteps});
}
'''
EXPORTS = '\nexport { BusLanesPipelineSolver as __busDiagPipeline, getBusLanesInputFromSrj as __busDiagAdapt, __busDiagMetadata as busDiagMetadata };\n'

def instrument(source):
    if '__busDiag' in source:
        raise ValueError('Source already instrumented')
    changes = []
    def edit(start, end, replacements):
        nonlocal source
        assert source.count(start) == 1, start
        a=source.index(start);b=source.index(end,a+len(start));block=source[a:b]
        for old,new in replacements:
            assert block.count(old)==1, (start,old,block.count(old))
            block=block.replace(old,new)
            changes.append({'block':start,'old':old,'new':new,'count':1})
        source=source[:a]+block+source[b:]
    edit('function getPendingExitCopperCost(', '\nfunction', [
        ('  return (copper) => guidesByConnection.reduce((cost, guides) => cost + (conflicts.firstConflict(copper, guides, clearance - 0.00000001) ? 10 * input.minTraceWidth : 0), 0);',
         '  return (copper) => {\n    const cost = guidesByConnection.reduce((cost, guides) => cost + (conflicts.firstConflict(copper, guides, clearance - 0.00000001) ? 10 * input.minTraceWidth : 0), 0);\n    __busDiag("pending.cost", {name: connection.name, cost, copper, foreignGuideGroups: guidesByConnection.length});\n    return cost;\n  };')])
    edit('function* pendingPackageExits(', '\nfunction', [
        ('  if (branches.length) {\n    const paths = yield* pendingLaneCertificates(input, branches, fixed, branchWidths);',
         '  if (branches.length) {\n    __busDiag("pending.active_branches", {connections: branches});\n    const paths = yield* pendingLaneCertificates(input, branches, fixed, branchWidths);\n    __busDiag("pending.active_paths", {traces: paths});')])
    edit('function* pendingLaneCertificates(', '\nvar RouteConflictIndex', [
        ('  for (const connection of connections) {\n    const width = widths.get(connection.name), search = new GridVisibilitySearch(',
         '  for (const connection of connections) {\n    __busDiag("certificate.search_start", {name: connection.name, start: connection.pointsToConnect[0], goalCount: connection.pointsToConnect.length - 1});\n    const __certificateStarted = performance.now();\n    const width = widths.get(connection.name), search = new GridVisibilitySearch('),
        ('    } finally {\n      if (!search.solved && !search.failed)\n        search.cancel();\n    }',
         '    } finally {\n      __busDiag("certificate.search_end", {name: connection.name, solved: search.solved, failed: search.failed, expanded: search.expanded, elapsedMs: performance.now() - __certificateStarted});\n      if (!search.solved && !search.failed)\n        search.cancel();\n    }')])
    edit('function* negotiateSignalSites(', '\nvar EXPANDED_GRID_PROBE_STEPS', [
        ('  if (!base.connections.length)\n    return null;',
         '  if (!base.connections.length)\n    return null;\n  const __siteCall = ++__busDiagSequence;\n  __busDiag("sites.begin", {call: __siteCall, names: base.connections.map(c => c.name), guideCount: options.pendingExits?.length ?? 0, allowPadEdgeSites: options.allowPadEdgeSites, expandEmptyDomainsOnly: options.expandEmptyDomainsOnly});'),
        ('    const pendingCost = pendingCosts.get(connection.name);',
         '    __busDiag("sites.domain", {call: __siteCall, name: connection.name, choiceCount: choices.length});\n    const pendingCost = pendingCosts.get(connection.name);'),
        ('    const chosen = [...routed.values()], escapes =',
         '    __busDiag("sites.finish", {call: __siteCall, selected: [...routed.values()]});\n    const chosen = [...routed.values()], escapes ='),
        ('    routed.set(connection.name, best);',
         '    routed.set(connection.name, best);\n    __busDiag("sites.selected", {call: __siteCall, name: connection.name, selected: best});')])
    for old,new in [
        ('function* pendingPackageExits(input, fixed) {','function* __busDiagOriginalPendingPackageExits(input, fixed) {'),
        ('function* routeGeneratedSignalSites(request) {','function* __busDiagOriginalRouteGeneratedSignalSites(request) {')]:
        assert source.count(old)==1
        source=source.replace(old,new);changes.append({'block':'rename','old':old,'new':new,'count':1})
    assert source.count('function getBusLanesInputFromSrj(')==1
    return HELPERS+source+EXPORTS,changes

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source',type=Path);parser.add_argument('dest',type=Path);args=parser.parse_args()
    assert args.source.resolve()!=args.dest.resolve()
    raw=args.source.read_bytes();assert hashlib.sha256(raw).hexdigest()==CORE_SHA
    output,changes=instrument(raw.decode());encoded=output.encode();args.dest.parent.mkdir(parents=True,exist_ok=True);args.dest.write_bytes(encoded)
    print(json.dumps({'sourceSha256':CORE_SHA,'instrumentedSha256':hashlib.sha256(encoded).hexdigest(),'replacementCount':len(changes),'bytes':len(encoded),'changes':changes}))

if __name__=='__main__':main()
