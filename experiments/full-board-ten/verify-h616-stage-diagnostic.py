#!/usr/bin/env python3
"""Authenticate one observational H616 run against its published native baseline."""

import gzip
import hashlib
import io
import json
import re
from pathlib import Path
import subprocess
import sys
import zipfile


CONTROLLER = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def decoded(data, name):
    return gzip.decompress(data) if name.endswith('.gz') else data


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def main():
    root = Path(sys.argv[1]).resolve()
    output = root / 'results/h616/spaced'
    plan = json.loads((CONTROLLER / 'h616-stage-diagnostic-plan.json').read_text())
    require(plan['frozen'] is True, 'Diagnostic plan is not frozen')
    for name, checksum in plan['unchangedFiles'].items():
        require(digest((CONTROLLER / name).read_bytes()) == checksum, f'Unchanged harness file drifted: {name}')
    for name, checksum in plan['diagnosticFiles'].items():
        require(digest((CONTROLLER / name).read_bytes()) == checksum, f'Reviewed observer file drifted: {name}')
    artifact = plan['baselineArtifact']
    api = f"repos/tscircuit/tscircuit-autorouter/actions/artifacts/{artifact['id']}"
    actual = json.loads(subprocess.check_output(['gh', 'api', api]))
    for key in ('id', 'name', 'size_in_bytes', 'digest', 'workflow_run'):
        require(actual[key] == artifact[key], f'Baseline artifact identity changed: {key}')
    archive = subprocess.check_output(['gh', 'api', api + '/zip'])
    require(len(archive) == artifact['size_in_bytes'] and 'sha256:' + digest(archive) == artifact['digest'],
            'Baseline archive size/digest changed')
    baseline = {}
    with zipfile.ZipFile(io.BytesIO(archive)) as packet:
        names = packet.namelist()
        require(len(names) == len(set(names)), 'Duplicate baseline archive members')
        for row in plan['baselineFiles']:
            data = packet.read(row['name'])
            require(len(data) == row['bytes'] and digest(data) == row['sha256'], f"Baseline member changed: {row['name']}")
            baseline[row['name']] = data
    read = lambda name: json.loads(decoded((output / name).read_bytes(), name))
    before = lambda name: json.loads(decoded(baseline[name], name))
    prefix = {}
    for name in ['unrouted.circuit.json.gz', *sorted(name for name in baseline if name.startswith('phase-'))]:
        data = decoded((output / name).read_bytes(), name)
        require(data == decoded(baseline[name], name), f'Observer changed native capture: {name}')
        prefix[name] = digest(data)
    require({p.name for p in output.glob('phase-*.gz')} == {name for name in baseline if name.startswith('phase-')},
            'Observer changed native phase captures')
    for name in ('circuit.json.gz', 'findings.json.gz'):
        require(canonical(read(name)) == canonical(before(name)), f'Observer changed saved physical output: {name}')
    assessment = read('assessment.json')
    require({k: v for k, v in assessment.items() if k != 'validationMs'} ==
            {k: v for k, v in before('assessment.json').items() if k != 'validationMs'},
            'Observer changed neutral physical assessment')
    progress, previous = read('progress.json'), before('progress.json')
    for key in ('id', 'cohort', 'mode', 'fanout', 'planes', 'sourceSha256', 'expectedGroups', 'status',
                'renderCompleted', 'errors', 'initialCopperCounts', 'dependencyOverrides',
                'forbiddenRoutingSolverSelections', 'coarseRoutingInstrumentation'):
        require(progress[key] == previous[key], f'Observer changed phase/source policy: {key}')
    timing = {'startedMs', 'elapsedMs', 'progress', 'iterationsPerSecond'}
    require([{k: v for k, v in phase.items() if k not in timing} for phase in progress['phases']] ==
            [{k: v for k, v in phase.items() if k not in timing} for phase in previous['phases']],
            'Observer changed native phase lifecycle')
    for key in ('routingSourceOverride', 'cacheEngine', 'candidateOverride'):
        require(progress['runtime'][key] is False, f'Unexpected runtime override: {key}')
    require(progress['wasmUsage']['routingOrUnknownAttempts'] == 0 and progress['wasmUsage']['geometryCalls'] == 0,
            'Unexpected WebAssembly usage')
    require([(p['name'], p['version'], p['entrySha256']) for p in progress['runtime']['packages']] ==
            [(p['name'], p['version'], p['entrySha256']) for p in previous['runtime']['packages']],
            'Published runtime identity changed')
    manifest = json.loads((root / 'runtime-manifest.json').read_text())
    require(manifest['sourceOverrides'] is False and manifest['dependencyOverrides'] == [], 'Runtime source override')
    for package in manifest['packages']:
        folder = Path(package['entry']).parent
        for _ in Path(package['entryRelative']).parts[:-1]:
            folder = folder.parent
        for row in package['publishedFiles']:
            require(digest((folder / row['path']).read_bytes()) == row['sha256'], 'Published runtime file changed')
    task = json.loads((root / 'cases/h616-spaced.json').read_text())
    for key, label in (('captureDeadlineMs', 'capture'), ('hardDeadlineMs', 'hard'), ('assessmentDeadlineMs', 'assessment')):
        require(task[key] == progress[key] == plan['limitsMs'][label], f'Native budget changed: {key}')
    result, process = read('result.json'), read('process.json')
    require(result['auditExitCode'] == 0 and not result['auditTimedOut'] and result['assessmentReady'], 'Assessment incomplete')
    require(process['renderExitCode'] == 0 and not process['hardTimedOut'], 'Native diagnostic process failed')
    require(result['connectedNets'] == 53 and result['sharedDrcErrorCount'] == 3 and result['geometryErrorCount'] == 0,
            'Published baseline result changed')
    observer = plan['observer']
    require(observer is not None, 'Stage observer contract is missing')
    report_path = output / observer['reportFile']
    report = json.loads(decoded(report_path.read_bytes(), report_path.name))
    require(report['schemaVersion'] == 1 and report['targetPhase'] == 'remaining', 'Wrong stage observation scope')
    require(report['inputSha256'] == plan['baselinePhase3InputRawSha256'], 'Stage observer input binding changed')
    require(re.fullmatch(r'[0-9a-f]{64}', report['normalizedOriginalSrjSha256']), 'Normalized input fingerprint missing')
    require(report['finished'] is True and report['prototypeRestored'] is True and report['observationError'] is None,
            'Observer failed, hit a bound, or did not restore the published prototype')
    require(report['stepCalls'] > 0 and 0 < report['snapshotBytes'] <= 8_000_000, 'Invalid observation size/count')
    require(report['completedGeometryStages'] == observer['requiredStages'], 'A required geometry boundary was not observed')
    snapshots = report['snapshots']
    labels = [snapshot['label'] for snapshot in snapshots]
    require(len(labels) == len(set(labels)) and len(labels) <= 32, 'Duplicate or excessive stage snapshots')
    require([label for label in labels if not label.startswith('joint.')] == observer['requiredStages'] + ['autorouting_end'],
            'Geometry stage order or final native event capture changed')
    require(set(labels) <= set(observer['requiredStages'] + ['autorouting_end'] + observer['optionalJointStages']),
            'Unreviewed stage label')
    native_input = before('phase-3-input.srj.json.gz')
    expected_pad = next(obstacle for obstacle in native_input['obstacles']
                        if obstacle.get('circuitJsonMetadata', {}).get('pcb_smtpad_id') == 'pcb_smtpad_475')
    require(report['pad'] == expected_pad, 'Observed target pad differs from authenticated native geometry')
    roots = {'source_net_67', 'source_net_68', 'source_net_69'}
    expected_connections = [connection for connection in native_input['connections'] if connection['name'] in roots]
    require(report['targetConnections'] == expected_connections, 'Observed target net/port binding changed')
    for snapshot in snapshots:
        require(snapshot['solved'] is True and snapshot['failed'] is False, 'A stage snapshot is not a completed result')
        require(snapshot['pipelineIteration'] >= 0 and snapshot['solverIterations'] >= 0, 'Missing stage iteration identity')
        collections = snapshot['routes']
        if not snapshot['label'].startswith('joint.'):
            require({route['root'] for route in collections['output']} == roots, 'Main stage omitted a target net')
        for routes in collections.values():
            require(isinstance(routes, list) and len(routes) <= 500, 'Invalid stored route collection')
            require(all(route['root'] in roots and isinstance(route['route'], list) for route in routes), 'Invalid target route geometry')
            require(sum(len(route['route']) for route in routes) <= 20_000, 'Route observation point bound exceeded')
    accepted_projection = []
    kept_fields = ('connectionName', 'rootConnectionName', 'connection_name', 'pcb_trace_id',
                   'traceThickness', 'viaDiameter', 'viaHoleDiameter', 'route', 'vias')
    for trace in before('phase-3-output.srj.json.gz')['traces']:
        owner = next((match.group(0) for field in
                      ('rootConnectionName', 'connectionName', 'connection_name')
                      if isinstance(trace.get(field), str)
                      and (match := re.match(r'^source_net_(?:67|68|69)(?=$|[_-])', trace[field]))), None)
        if owner is not None:
            accepted_projection.append({'root': owner, **{key: trace[key] for key in kept_fields if key in trace}})
    require(snapshots[-1]['label'] == 'autorouting_end' and
            snapshots[-1]['routes']['output'] == accepted_projection,
            'Final stage snapshot does not match authenticated accepted phase3 geometry')
    require(progress['pipelineStageInstrumentation'] == {'enabled': True, 'targetPhase': 'remaining',
            'mode': 'immutable published-stage geometry snapshots'}, 'Renderer observation scope changed')
    evidence = {'passed': True, 'artifact': artifact, 'archiveDigestAndSizeVerified': True,
                'nativeCapturesByteIdentical': prefix, 'physicalCircuitAndFindingsIdentical': True,
                'nativeAssessmentUnchanged': True, 'runtimePublishedFilesUnchanged': True,
                'stageReportSha256': digest(report_path.read_bytes()), 'stageLabels': labels,
                'observerRestored': True, 'observationCompleteAndUncapped': True, 'routingChanges': False,
                'renderWallMs': process['renderWallMs'], 'timingIsDiagnosticOnly': True}
    (root / 'h616-stage-parity.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence, sort_keys=True))


if __name__ == '__main__':
    main()
