#!/usr/bin/env python3
"""Qualify saved native output; never import or execute a router.

Physical legality/connectivity comes from the unchanged cohort assessor. Exact
accepted-SRJ materialization checks follow the earlier Core publication verifier.
"""

from collections import Counter
import copy
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile


CONTROLLER = Path(__file__).resolve().parent
BASELINE_RUN = 44179934754
BASELINE_HEAD = '29cacbbcce6b3acb6ee09a8d67cff3223f49597e'
BASELINE_ARTIFACT = 14372554326
PUBLISHED_CORE_SHA256 = '53798b0d37ae966acca93e503de4d20e6bb98086d9ec27313646030c364ec519'
LAYERS = ('top', 'inner1', 'inner2', 'inner3', 'inner4', 'inner5', 'inner6', 'bottom')
PHYSICAL_FINDINGS = {'trace_overlap', 'pad_trace', 'via_trace', 'via_pad',
                     'via_spacing', 'contiguous', 'via_in_pad', 'hole_trace'}
OTHER_FINDINGS = {'missing_traces', 'disconnected_ports', 'width'}
EXPECTED_COUNTS = {'source_component': 350, 'source_net': 317,
                   'pcb_smtpad': 1557, 'pcb_plated_hole': 56, 'pcb_hole': 10}
IGNORED_RENDER_ROWS = {'pcb_trace', 'pcb_via', 'pcb_debug_object',
                       'pcb_autorouting_error', 'pcb_port_not_connected_error',
                       'pcb_missing_trace_error', 'pcb_trace_warning'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def read_bytes(path):
    data = path.read_bytes()
    return gzip.decompress(data) if path.name.endswith('.gz') else data


def read_json(path):
    return json.loads(read_bytes(path))


def indexed(rows, key):
    require(all(isinstance(row.get(key), str) for row in rows), f'Missing {key}')
    result = {row[key]: row for row in rows}
    require(len(result) == len(rows), f'Duplicate {key}')
    return result


def authenticate_baseline(root, plan):
    expected = plan['baselineArtifact']
    require(expected['id'] == BASELINE_ARTIFACT and
            expected['workflow_run']['id'] == BASELINE_RUN and
            expected['workflow_run']['head_sha'] == BASELINE_HEAD,
            'Wrong frozen baseline identity')
    api = f'repos/tscircuit/tscircuit-autorouter/actions/artifacts/{BASELINE_ARTIFACT}'
    actual = json.loads(subprocess.check_output(['gh', 'api', api]))
    for key in ('id', 'name', 'size_in_bytes', 'digest', 'workflow_run'):
        require(actual[key] == expected[key], f'Baseline artifact metadata changed: {key}')
    raw = subprocess.check_output(['gh', 'api', api + '/zip'])
    require(len(raw) == expected['size_in_bytes'] and 'sha256:' + sha(raw) == expected['digest'],
            'Baseline archive size/digest changed')
    baseline = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), 'Duplicate baseline archive members')
        require(all(not Path(name).is_absolute() and '..' not in Path(name).parts for name in names),
                'Invalid baseline member path')
        for member in plan['baselineFiles']:
            data = archive.read(member['name'])
            require(len(data) == member['bytes'] and sha(data) == member['sha256'],
                    f"Baseline member differs: {member['name']}")
            baseline[member['name']] = gzip.decompress(data) if member['name'].endswith('.gz') else data
    proof = {'artifact': expected, 'archiveDigestAndSizeVerified': True,
             'memberHashes': {name: sha(data) for name, data in baseline.items()},
             'downloadedOnce': True}
    (root / 'bus-repeat-baseline-proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    return baseline, proof


def native_names(task, circuit):
    source_path = Path(task['sourcePath'])
    source_bytes = source_path.read_bytes()
    require(sha(source_bytes) == task['sourceSha256'], 'Authentic board source changed')
    source = json.loads(gzip.decompress(source_bytes))
    traces = [trace for trace in source['traces'] if len(trace['path']) > 1]
    by_declared_name = {trace['name']: trace['nativeNet'] for trace in traces}
    require(len(by_declared_name) == len(traces) == 317, 'Native net declarations changed')
    require(len(set(by_declared_name.values())) == 317, 'Duplicate native net names')
    nets = indexed([row for row in circuit if row['type'] == 'source_net'], 'source_net_id')
    require({row['name'] for row in nets.values()} == set(by_declared_name), 'Source net membership changed')
    return {identifier: by_declared_name[row['name']] for identifier, row in nets.items()}


def connected_names(assessment, names):
    missing = assessment['unconnectedNets']
    require(len(missing) == len(set(missing)) and set(missing) <= set(names.values()),
            'Invalid native unconnected-name inventory')
    connected = set(names.values()) - set(missing)
    require(assessment['requestedNets'] == 317 and assessment['connectedNets'] == len(connected),
            'Neutral native connectivity count disagrees with names')
    return connected


def source_owners(circuit):
    nets = indexed([row for row in circuit if row['type'] == 'source_net'], 'source_net_id')
    traces = indexed([row for row in circuit if row['type'] == 'source_trace'], 'source_trace_id')

    def owner(identifier):
        if identifier in nets:
            return identifier
        require(identifier in traces, f'Unknown source copper owner: {identifier}')
        owners = traces[identifier]['connected_source_net_ids']
        require(len(set(owners)) == 1 and owners[0] in nets, 'Copper owner is not one native net')
        return owners[0]

    return owner, nets


def physical_route(route):
    """Exact stored geometry, permitting Core's documented route reversal."""
    points = []
    require(len(route) >= 2, 'Accepted route has too few points')
    for point in route:
        kind = point['route_type']
        require(kind in {'wire', 'via'}, 'Unreviewed accepted route primitive')
        keys = ('x', 'y', 'layer', 'width') if kind == 'wire' else (
            'x', 'y', 'via_diameter', 'via_hole_diameter')
        value = {key: point[key] for key in keys}
        value['route_type'] = kind
        if kind == 'via':
            require(point['from_layer'] in LAYERS and point['to_layer'] in LAYERS,
                    'Invalid logical via transition')
            if 'layers' in point:
                require(tuple(point['layers']) == LAYERS, 'Unexpected accepted physical via span')
            value['transition'] = sorted((point['from_layer'], point['to_layer']))
        else:
            require(point['layer'] in LAYERS and point['width'] > 0, 'Invalid accepted wire geometry')
        points.append(value)
    return min(canonical(points), canonical(list(reversed(points))))


def trace_identity(trace, owner):
    return (owner(trace['connection_name']), physical_route(trace['route']))


def require_retained(accepted, traces, owner, label):
    current = indexed(traces, 'pcb_trace_id')
    for identifier, trace in accepted.items():
        require(identifier in current and trace_identity(current[identifier], owner) == trace_identity(trace, owner),
                f'Accepted copper changed or vanished in {label}: {identifier}')
    return current


def verify_materialization(circuit, accepted):
    """Check all emitted copper against complete accepted phase outputs.

    Same-net branches may share one physical through-via. Its emitted owner must
    still contain the exact logical transition and manufactured dimensions.
    """
    owner, nets = source_owners(circuit)
    traces = indexed([row for row in circuit if row['type'] == 'pcb_trace'], 'pcb_trace_id')
    require(set(traces) == set(accepted), 'Emitted traces differ from complete accepted outputs')
    expected_vias, transitions = set(), {}
    for identifier, native in accepted.items():
        emitted = traces[identifier]
        native_owner = owner(native['connection_name'])
        require(owner(emitted['source_trace_id']) == native_owner, 'Materialized trace net owner changed')
        if 'connection_name' in emitted:
            require(owner(emitted['connection_name']) == native_owner, 'Materialized connection owner changed')
        require(physical_route(emitted['route']) == physical_route(native['route']),
                f'Accepted route changed during materialization: {identifier}')
        transitions[identifier] = set()
        for point in native['route']:
            if point['route_type'] != 'via':
                continue
            geometry = (point['x'], point['y'], point['via_diameter'], point['via_hole_diameter'])
            expected_vias.add((native_owner, *geometry, LAYERS))
            transitions[identifier].add((*geometry, tuple(sorted((point['from_layer'], point['to_layer'])))))
    actual_vias = []
    vias = indexed([row for row in circuit if row['type'] == 'pcb_via'], 'pcb_via_id')
    for via in vias.values():
        identifier = via['pcb_trace_id']
        require(identifier in accepted, 'Physical via has no accepted trace owner')
        require(tuple(via['layers']) == LAYERS, 'Physical via span changed')
        geometry = (via['x'], via['y'], via['outer_diameter'], via['hole_diameter'])
        transition = (*geometry, tuple(sorted((via['from_layer'], via['to_layer']))))
        require(transition in transitions[identifier], 'Physical via owner lacks its exact transition')
        net = owner(accepted[identifier]['connection_name'])
        require(via['subcircuit_connectivity_map_key'] == nets[net]['subcircuit_connectivity_map_key'],
                'Physical via connectivity owner changed')
        actual_vias.append((net, *geometry, LAYERS))
    require(len(actual_vias) == len(set(actual_vias)) and set(actual_vias) == expected_vias,
            'Missing, additional, duplicate or wrongly owned physical vias')
    return {'acceptedTraces': len(accepted), 'physicalVias': len(actual_vias),
            'sharedViaDeduplicationByNativeNetAndPhysicalGeometry': True}


def verify_phase_outputs(folder, progress, circuit, baseline):
    owner, _ = source_owners(circuit)
    phases = progress['phases']
    expected_groups = progress['expectedGroups']
    require([phase['name'] for phase in phases] == expected_groups[:len(phases)], 'Native phase order changed')
    require(len(phases) >= 2 and [phase['name'] for phase in phases[:2]] == ['byte0', 'byte1'] and
            all(phase['status'] == 'completed' for phase in phases[:2]),
            'Both complete native DDR byte phases are required')
    accepted, summaries, expected_files = {}, [], set()
    first_two = {}
    for index, phase in enumerate(phases, 1):
        require(phase['index'] == index and phase['status'] in {'completed', 'failed', 'running'},
                'Unexpected native phase lifecycle')
        input_name = f'phase-{index}-input.srj.json.gz'
        input_path = folder / input_name
        expected_files.add(input_name)
        srj = read_json(input_path)
        require(sha(read_bytes(input_path)) == phase['inputSha256'], 'Native phase input hash disagrees')
        connections = indexed(srj['connections'], 'name')
        require(len(connections) == phase['connections'] and
                sum(len(connection['pointsToConnect']) for connection in connections.values()) == phase['terminals'],
                'Native phase net/terminal counts changed')
        require_retained(accepted, srj.get('traces', []), owner, f'phase{index} input')
        require(set(indexed(srj.get('traces', []), 'pcb_trace_id')) == set(accepted),
                'Phase input contains copper outside accepted earlier outputs')
        if index <= 2:
            old_srj = json.loads(baseline[input_name])
            require(canonical({k:v for k,v in srj.items() if k != 'traces'}) ==
                    canonical({k:v for k,v in old_srj.items() if k != 'traces'}),
                    'DDR phase membership, constraints or fixed obstacles changed')
            require(len(connections) == 8 and phase['terminals'] == 24, 'Full three-terminal byte is required')
            first_two[phase['name']] = set(connections)
        if phase['status'] == 'completed':
            output_name = f'phase-{index}-output.srj.json.gz'
            expected_files.add(output_name)
            output = read_json(folder / output_name)
            require(canonical({k:v for k,v in output.items() if k != 'traces'}) ==
                    canonical({k:v for k,v in srj.items() if k != 'traces'}),
                    'Accepted phase output changed native routing intent')
            current = require_retained(accepted, output['traces'], owner, f'phase{index} accepted output')
            additions = set(current) - set(accepted)
            require(all(owner(current[identifier]['connection_name']) in {owner(name) for name in connections}
                        for identifier in additions), 'Accepted trace belongs to a different phase')
            accepted = current
            summaries.append({'phase': phase['name'], 'acceptedTraceCount': len(accepted),
                              'newTraceCount': len(additions), 'inputSha256': phase['inputSha256']})
        else:
            require(index == len(phases), 'A later phase started after an incomplete phase')
            if phase['status'] == 'failed':
                error_name = f'phase-{index}-error.srj.json.gz'
                expected_files.add(error_name)
                require(read_bytes(folder / error_name) == read_bytes(input_path),
                        'Failed phase diagnostic differs from its input')
    require({path.name for path in folder.glob('phase-*.srj.json.gz')} == expected_files,
            'Unexpected phase output, including possible unaccepted partial routes')
    return first_two, summaries, verify_materialization(circuit, accepted)


def lifecycle_diagnostics(folder, progress):
    require(progress['busLifecycleInstrumentation'] == {
        'enabled': True, 'phases': ['byte0','byte1'], 'originalMethodsOnce': True,
        'selectedCoreConstructorIdentity': True}, 'Unexpected Bus observation scope')
    summaries = []
    for phase_name in ('byte0','byte1'):
        phase = next(row for row in progress['phases'] if row['name'] == phase_name)
        report = read_json(folder / f'bus-{phase_name}-lifecycle.json')
        require(report['phase'] == phase_name and report['inputSha256'] == phase['inputSha256'],
                'Bus lifecycle input does not match its actual native phase')
        require(report['captureValid'] is True and report['restored'] is True and
                report['originalStepExactlyOnce'] is True and report['calls'] == report['originalCalls'] > 0 and
                report['observerErrors'] == [] and report['capped'] == [] and report['instances'],
                'Bus lifecycle observation failed, was capped, or changed original calls')
        pipelines = [row for row in report['instances'] if row['kind'] == 'pipeline']
        require(pipelines and all(type(row['initial']['hasExhaustedGeneratedSites']) is bool for row in pipelines),
                'Observed pipeline does not contain the qualified candidate marker')
        exhausted = {row['id'] for row in report['transitions'] if row.get('hasExhaustedGeneratedSites') is True}
        exhausted.update(row['id'] for row in pipelines if row['current'].get('hasExhaustedGeneratedSites') is True)
        subsequent = [{'id': row['id'], 'phase': row['phase'], 'attempt': row['attempt'],
                       'iterations': row['iterations'], 'solved': row['solved'], 'failed': row['failed']}
                      for row in report['transitions'] if row.get('hasExhaustedGeneratedSites') is True]
        summaries.append({'phase':phase_name, 'originalCalls':report['originalCalls'],
                          'exhaustionMarkerObservedInInstances':sorted(exhausted),
                          'observedTransitionsAfterExhaustion':subsequent,
                          'diagnosticOnly':True})
    return summaries


def verify_native(folder, task, baseline):
    read = lambda name: read_json(folder / name)
    old = lambda name: json.loads(baseline[name])
    progress, result, assessment, process = [read(name) for name in
                                            ('progress.json', 'result.json', 'assessment.json', 'process.json')]
    for value in (progress, result):
        require(value['id'] == 'butterstick' and value['cohort'] == 'spaced', 'Wrong native circuit')
    require(result['executionMode'] == 'full' and result['memoryCap'] is None,
            'Geometry-only or memory-capped run is not eligible')
    require(result['completeSourceCounts'] and result['routingPolicyObserved'], 'Authentic circuit/policy was not retained')
    require(result['auditExitCode'] == 0 and not result['auditTimedOut'] and result['assessmentReady'],
            'Neutral physical assessment incomplete')
    require(result['renderExitCode'] in (0, 124) and not result['hardTimedOut'], 'Native render failed or was hard-killed')
    for key in ('renderExitCode', 'hardTimedOut', 'captureDeadlineMs', 'hardDeadlineMs', 'executionMode', 'memoryCap'):
        require(result[key] == process[key], f'Native process/result disagree: {key}')
    require([progress[key] for key in ('captureDeadlineMs', 'hardDeadlineMs', 'assessmentDeadlineMs')] == [900000,960000,180000] and
            [task[key] for key in ('captureDeadlineMs', 'hardDeadlineMs', 'assessmentDeadlineMs')] == [900000,960000,180000],
            'Native deadlines changed')
    for key in ('mode', 'fanout', 'planes', 'sourceSha256', 'expectedGroups', 'initialCopperCounts',
                'forbiddenRoutingSolverSelections', 'coarseRoutingInstrumentation'):
        require(progress[key] == old('progress.json')[key], f'Native source/routing policy changed: {key}')
    require(progress['sourceSha256'] == task['sourceSha256'], 'Renderer source fingerprint differs from task')
    require(progress['wasmUsage']['routingOrUnknownAttempts'] == progress['wasmUsage']['geometryCalls'] == 0,
            'WebAssembly was used during routing')
    require(result['wasmUsage'] == progress['wasmUsage'], 'WASM accounting disagrees')
    for name in ('unrouted.circuit.json.gz', 'phase-1-input.srj.json.gz'):
        require(read_bytes(folder / name) == baseline[name], f'Native initial input changed: {name}')
    circuit = read('circuit.json.gz')
    unrouted = old('unrouted.circuit.json.gz')
    require(not any(row['type'] in {'pcb_trace', 'pcb_via', 'pcb_copper_pour'} for row in unrouted),
            'Unreviewed initial authored copper must be preserved explicitly')
    require(Counter(canonical(row) for row in circuit if row['type'] not in IGNORED_RENDER_ROWS) ==
            Counter(canonical(row) for row in unrouted if row['type'] not in IGNORED_RENDER_ROWS),
            'Authentic source/component/pad/hole/pour geometry changed')
    counts = Counter(row['type'] for row in circuit)
    require(all(counts[k] == result['emittedCounts'][k] == v for k,v in EXPECTED_COUNTS.items()),
            'Authentic component inventory changed')
    require(result['geometryErrorCount'] == 0 and assessment['geometryErrors'] == [], 'Fixed board geometry audit failed')
    findings = read('findings.json.gz')
    require(set(findings) == PHYSICAL_FINDINGS | OTHER_FINDINGS == set(old('findings.json.gz')),
            'Neutral assessment finding groups changed')
    for group in PHYSICAL_FINDINGS | {'width'}:
        require(old('findings.json.gz')[group] == [] and findings[group] == [],
                f'New physical finding or width warning: {group}')
    for group, rows in findings.items():
        require(assessment['findings'][group] == sum(row['type'].endswith('_error') for row in rows),
                f'Neutral assessment count differs: {group}')
    require(result['sharedDrcErrorCount'] == 0 and all(value == 0 for value in result['sharedDrcByGroup'].values()),
            'Neutral physical result contains new conflicts')
    names = native_names(task, circuit)
    prior = connected_names(old('assessment.json'), names)
    connected = connected_names(assessment, names)
    require(prior == {f'/FPGA-DDR3L/DQ{i}' for i in range(8)}, 'Wrong baseline native completion set')
    require(prior <= connected, 'Previously connected native DDR nets were lost')
    required_new = {f'/FPGA-DDR3L/DQ{i}' for i in range(8,16)}
    require(required_new <= connected and len(connected) >= 16, 'Second DDR byte did not produce eight actual completed nets')
    require(result['connectedNets'] == len(connected) and result['requestedRoutableNets'] == 317,
            'Native result count disagrees with actual names')
    first_two, phases, materialization = verify_phase_outputs(folder, progress, circuit, baseline)
    require({names[name] for name in first_two['byte0']} == prior and
            {names[name] for name in first_two['byte1']} == required_new,
            'Accepted DDR bytes do not own the required native nets')
    return {'passed': True, 'connectedBefore': 8, 'connectedAfter': len(connected), 'requested': 317,
            'gainedNativeNets': sorted(connected-prior), 'lostNativeNets': sorted(prior-connected),
            'fullSecondByteConnected': True, 'nativeSourceAndInitialInputUnchanged': True,
            'authenticFixedGeometryPreserved': True, 'noNewPhysicalFindings': True,
            'noNewWidthWarnings': True, 'acceptedPhases': phases, 'materialization': materialization,
            'busLifecycle': lifecycle_diagnostics(folder, progress),
            'phaseFrontier': [{'name': row['name'], 'status': row['status']} for row in progress['phases']],
            'renderWallMs': result['renderWallMs'], 'timingIsDiagnosticOnly': True}


def verify_source_install(root, plan, progress):
    mapping_path = root / 'bus-repeat-source/source-mapping.json'
    mapping = read_json(mapping_path)
    gate = read_json(root / 'bus-repeat-source/source-gate.json')
    install = read_json(root / 'bus-repeat-install-proof.json')
    require(sha(mapping_path.read_bytes()) == plan['expectedSourceMappingSha256'],
            'Source equivalence proof changed')
    require(mapping['passed'] is True and mapping['sourceFiles'] == plan['source']['files'] and
            mapping['originalCoreSha256'] == PUBLISHED_CORE_SHA256 and
            mapping['candidateCoreSha256'] == plan['expectedCandidateCoreSha256'],
            'Candidate source mapping differs from the reviewed patch')
    require(mapping['bun'] == '1.4.3' and mapping['typescript'] == '5.9.3' and
            not mapping['nativeRoutingExecuted'] and not mapping['moduleImported'],
            'Unexpected source-equivalence process')
    changed = {row['name']: row for row in mapping['replacedDeclarations']}
    require(set(changed) == {'BusLanesPipelineSolver', 'completeGeneratedSignalSites', 'negotiateGeneratedSignalSites'} and
            len(mapping['replacedDeclarations']) == 3 and
            [row['name'] for row in mapping['unchangedDeclarations']] == ['routeGeneratedSignalSites'],
            'Unreviewed compiled declaration changed')
    require(gate['passed'] is True and gate['formatPassed'] is True and gate['formatVersion'] == '2.5.15' and
            gate['productionPatchSha256'] == plan['source']['productionPatchSha256'] and
            gate['sourceMappingSha256'] == plan['expectedSourceMappingSha256'] and
            gate['candidateCoreSha256'] == plan['expectedCandidateCoreSha256'] and
            not gate['runtimeAliasesChanged'] and gate['toolsIsolatedFromRuntime'] and not gate['nativeBoardRouted'],
            'Source/test/format qualification did not pass')
    require(gate['tests']['base']['exitCode'] == 1 and gate['tests']['candidate']['exitCode'] == 0,
            'Expected failing repro/passing source candidate was not established')
    for lane, test in gate['tests'].items():
        require(test['originalTestSha256'] == plan['source']['testSha256'] and
                sha((root / f'bus-repeat-source/{lane}-test.log').read_bytes()) == test['logSha256'],
                'Qualified source test or log changed')
    require(sha((root / 'bus-repeat-source/format.log').read_bytes()) == gate['formatLogSha256'],
            'Qualified formatting log changed')
    require(install['sourceGate'] == gate and install['sourceMappingSha256'] == plan['expectedSourceMappingSha256'] and
            install['candidateCoreSha256'] == plan['expectedCandidateCoreSha256'] and
            install['originalAutorouterSha256'] == plan['unchangedAutorouterSha256'],
            'Installed runtime differs from qualified source')
    original = Path(install['originalCoreEntry']).read_bytes()
    require(sha(original) == PUBLISHED_CORE_SHA256, 'Published original Core was modified')
    candidate = original
    spans = install['anchor']['spans']
    require(len(spans) == 3 and {span['name'] for span in spans} == set(changed), 'Installed span inventory changed')
    for span in sorted(spans, key=lambda row: row['byteOffset'], reverse=True):
        require({key:value for key,value in span.items() if key not in {'oldBlock','newBlock'}} == changed[span['name']],
                'Installed declaration metadata differs from source proof')
        old, new = span['oldBlock'].encode(), span['newBlock'].encode()
        offset = span['byteOffset']
        require(sha(old) == span['oldBlockSha256'] and sha(new) == span['newBlockSha256'] and
                original[offset:offset + len(old)] == old and original.count(old) == 1,
                'Installed declaration bytes/position differ from source proof')
        candidate = candidate[:offset] + new + candidate[offset + len(old):]
    require(sha(candidate) == plan['expectedCandidateCoreSha256'], 'Reconstructed candidate Core differs')
    manifest = read_json(root / 'runtime-manifest.json')
    before = read_json(root / 'bus-repeat-original-runtime.json')
    require(before['runner'] == manifest['runner'] and
            manifest['runner']['architecture'] in {'arm64','aarch64'} and
            manifest['runner']['cpuCount'] == 8 and manifest['runner']['bun'] == '1.4.3' and
            manifest['runner']['artificialMemoryLimitApplied'] is False,
            'Declared native runner identity or memory policy changed')
    require(before['mainVersion'] == manifest['mainVersion'] == '0.0.3230' and
            before['experiment'] == manifest['experiment'] == 'published' and
            before['sourceOverrides'] is False and before['dependencyOverrides'] == [] and
            manifest['sourceOverrides'] is True, 'Unexpected runtime provenance')
    override = [{'name': '@tscircuit/core', 'from': 'published0.0.2407', 'to': 'published0.0.2407-with-bus-repeat',
                 'reason': 'Skip repeated generated-site negotiation only after ordinary site choices naturally exhaust; unchanged provisional caps and layer retries'}]
    require(manifest['dependencyOverrides'] == progress['dependencyOverrides'] == override,
            'Unexpected runtime dependency override')
    old_packages = {row['name']: row for row in before['packages']}
    packages = {row['name']: row for row in manifest['packages']}
    require(set(packages) == set(old_packages) == {'tscircuit','@tscircuit/core','@tscircuit/eval','@tscircuit/capacity-autorouter'},
            'Frozen package chain changed')
    release = read_json(CONTROLLER / 'release.json')
    require({name:(row['version'],row['entrySha256']) for name,row in old_packages.items()} ==
            {row['name']:(row['version'],row['entrySha256']) for row in release['packages']},
            'Original package graph differs from the frozen published release')
    actual = {row['name']: (row['version'], row['entrySha256']) for row in progress['runtime']['packages']}
    expected = {name: (row['version'], plan['expectedCandidateCoreSha256'] if name == '@tscircuit/core' else row['entrySha256'])
                for name,row in old_packages.items()}
    require(actual == expected and progress['runtime']['candidateOverride'] is True and
            progress['runtime']['routingSourceOverride'] is False and progress['runtime']['cacheEngine'] is False,
            'Renderer used a different package graph')
    core = packages['@tscircuit/core']
    require({key:value for key,value in core.items() if key not in {'entry','entrySha256'}} ==
            {key:value for key,value in old_packages['@tscircuit/core'].items() if key not in {'entry','entrySha256'}},
            'Candidate Core metadata changed outside its selected entry')
    require(Path(core['entry']) == Path(install['candidateFolder']) / core['entryRelative'] and
            Path(core['entry']).read_bytes() == candidate, 'Installed candidate Core bytes differ')
    for name, package in packages.items():
        require(package['version'] == old_packages[name]['version'], 'Package version changed')
        if name != '@tscircuit/core':
            require(package == old_packages[name], 'Non-Core package metadata changed')
    for alias in install['originalAliases']:
        require(Path(alias['path']) == root / 'runtime/node_modules' / alias['name'] and
                Path(alias['path']).resolve() == Path(alias['target']) == root / 'npm' / old_packages[alias['name']]['label'],
                'Published aliases were not restored before assessment')
    require({alias['name'] for alias in install['originalAliases']} == set(packages), 'Missing restored package alias')
    task = read_json(Path(install['casePath']))
    policy = {key:value for key,value in task.items() if key not in {'dependencyOverrides','busRepeatCandidate'}}
    require(sha(json.dumps(policy,sort_keys=True).encode()) == install['casePolicySha256'],
            'Authentic case policy changed during source installation')
    identity = {'originalCoreSha256': PUBLISHED_CORE_SHA256, 'candidateCoreSha256': plan['expectedCandidateCoreSha256']}
    require(task['busRepeatCandidate'] == manifest['busRepeatCandidate'] == identity and
            task['dependencyOverrides'] == override, 'Task does not select the qualified candidate')
    checks = []
    for name in ('bus-repeat-assessment-proof.json', 'bus-repeat-post-proof.json'):
        proof = read_json(root / name)
        require(all(proof[key] is True for key in ('originalPublishedFilesVerified','candidateFilesVerified',
                    'neutralHelperVerified','assessmentUsesOriginalCore','casePolicyVerified','dependencyGraphVerified')) and
                proof['candidateCoreSha256'] == plan['expectedCandidateCoreSha256'] and
                proof['originalAutorouterSha256'] == plan['unchangedAutorouterSha256'] and
                proof['immutableFileCount'] == len(install['immutableFiles']),
                'Published neutral assessment or complete runtime graph verification failed')
        checks.append({'file':name,'sha256':sha((root/name).read_bytes())})
    require(install['dependencyGraph'], 'Complete dependency graph inventory is missing')
    require(install['resolutionAliases'], 'Module-resolution alias inventory is missing')
    for alias in install['resolutionAliases']:
        path = Path(alias['path'])
        require(path.is_symlink() and str(path.readlink()) == alias['target'],
                'Unchanged module-resolution alias drifted')
    return {'sourceMappingSha256':plan['expectedSourceMappingSha256'],
            'candidateCoreSha256':plan['expectedCandidateCoreSha256'],
            'onlyReviewedDeclarationsChanged':sorted(changed), 'sourceTestsAndFormatPassed':True,
            'neutralAssessmentUsesPublishedCore':True, 'completeDependencyGraphVerified':True,
            'restorationAndPostRunProofs':checks}


def self_test(folder):
    """Exercise materialization guards with real accepted saved copper only."""
    circuit = read_json(folder / 'circuit.json.gz')
    accepted = indexed(read_json(folder / 'phase-1-output.srj.json.gz')['traces'], 'pcb_trace_id')
    positive = verify_materialization(circuit, accepted)
    owner, _ = source_owners(circuit)
    require_retained(accepted, list(accepted.values()), owner, 'control')
    rejected = []

    def rejects(label, callback):
        try:
            callback()
        except (ValueError, KeyError):
            rejected.append(label)
            return
        raise AssertionError(f'Invalid saved output was accepted: {label}')

    moved = copy.deepcopy(circuit)
    next(row for row in moved if row['type'] == 'pcb_trace')['route'][0]['x'] += 0.1
    rejects('moved_accepted_trace', lambda: verify_materialization(moved, accepted))
    missing = copy.deepcopy(circuit)
    missing.remove(next(row for row in missing if row['type'] == 'pcb_via'))
    rejects('missing_physical_via', lambda: verify_materialization(missing, accepted))
    duplicate = copy.deepcopy(circuit)
    via = copy.deepcopy(next(row for row in duplicate if row['type'] == 'pcb_via'))
    via['pcb_via_id'] += '_duplicate'
    duplicate.append(via)
    rejects('duplicate_physical_via', lambda: verify_materialization(duplicate, accepted))
    bad_owner = copy.deepcopy(circuit)
    via = next(row for row in bad_owner if row['type'] == 'pcb_via')
    net = owner(accepted[via['pcb_trace_id']]['connection_name'])
    other = next(identifier for identifier, trace in accepted.items()
                 if owner(trace['connection_name']) == net and not any(p['route_type'] == 'via' for p in trace['route']))
    via['pcb_trace_id'] = other
    rejects('via_owner_without_transition', lambda: verify_materialization(bad_owner, accepted))
    changed_input = copy.deepcopy(list(accepted.values()))
    changed_input[0]['route'][0]['x'] += 0.1
    rejects('earlier_phase_copper_changed', lambda: require_retained(accepted, changed_input, owner, 'control'))
    shared_circuit = copy.deepcopy(circuit)
    shared_accepted = copy.deepcopy(accepted)
    shared_trace = copy.deepcopy(next(row for row in shared_circuit if row['type'] == 'pcb_trace'))
    old_id = shared_trace['pcb_trace_id']
    shared_trace['pcb_trace_id'] += '_shared_branch'
    shared_circuit.append(shared_trace)
    shared_native = copy.deepcopy(accepted[old_id])
    shared_native['pcb_trace_id'] = shared_trace['pcb_trace_id']
    shared_accepted[shared_native['pcb_trace_id']] = shared_native
    shared = verify_materialization(shared_circuit, shared_accepted)
    require(shared['physicalVias'] == positive['physicalVias'], 'Shared physical via was double counted')
    print(json.dumps({'passed': True, 'realSavedCopperAccepted': positive,
                      'sharedSameNetViasAccepted': shared, 'invalidSavedOutputRejected': rejected}))


def main():
    if sys.argv[1] == '--self-test':
        self_test(Path(sys.argv[2]))
        return
    root = Path(sys.argv[1]).resolve()
    folder = root / 'results/butterstick/spaced'
    proof = {'passed': False}
    baseline = None
    try:
        plan = read_json(CONTROLLER / 'bus-repeat-plan.json')
        require(plan['frozen'] is True, 'Bus candidate plan is not frozen')
        baseline, baseline_proof = authenticate_baseline(root, plan)
        proof['baseline'] = baseline_proof
        task = read_json(root / 'cases/butterstick-spaced.json')
        proof['sourceQualification'] = verify_source_install(root, plan, read_json(folder / 'progress.json'))
        proof.update(verify_native(folder, task, baseline))
    except Exception as error:
        proof['rejectedReason'] = str(error)
        try:
            progress = read_json(folder / 'progress.json')
            result = read_json(folder / 'result.json')
            proof['reportedConnectedNets'] = result['connectedNets']
            proof['phaseFrontier'] = [{'name':row['name'],'status':row['status']} for row in progress['phases']]
            if baseline is not None:
                try:
                    names = native_names(read_json(root / 'cases/butterstick-spaced.json'), read_json(folder / 'circuit.json.gz'))
                    old_names = connected_names(json.loads(baseline['assessment.json']), names)
                    new_names = connected_names(read_json(folder / 'assessment.json'), names)
                    proof['reportedGainedNativeNets'] = sorted(new_names - old_names)
                    proof['reportedLostNativeNets'] = sorted(old_names - new_names)
                    findings = read_json(folder / 'findings.json.gz')
                    proof['reportedPhysicalFindingCounts'] = {key:len(findings[key]) for key in sorted(PHYSICAL_FINDINGS | {'width'})}
                except Exception as count_error:
                    proof['namedObservationError'] = str(count_error)
            try:
                proof['busLifecycle'] = lifecycle_diagnostics(folder, progress)
            except Exception as diagnostic_error:
                proof['lifecycleRejectedReason'] = str(diagnostic_error)
        except Exception as observation_error:
            proof['observationReadError'] = str(observation_error)
        (root / 'bus-repeat-native-proof.json').write_text(json.dumps(proof, indent=2) + '\n')
        print(json.dumps(proof, sort_keys=True))
        raise
    else:
        (root / 'bus-repeat-native-proof.json').write_text(json.dumps(proof, indent=2) + '\n')
        print(json.dumps(proof, sort_keys=True))


if __name__ == '__main__':
    main()
