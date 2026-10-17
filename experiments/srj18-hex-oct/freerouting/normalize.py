#!/usr/bin/env python3
"""Parse saved SES and publish flat SRJ results for the common evaluator."""
import argparse,json
from pathlib import Path
from run import ses_to_srj

def normalize(root,dataset):
    for directory in sorted(root.glob('sample*')):
        if not directory.is_dir():continue
        paths=[directory/x for x in ['output.ses','mapping.json','result.json']]
        if not all(p.exists()for p in paths):continue
        metadata=json.loads(paths[2].read_text())
        if metadata['status'] in ['failed','setup-error','process-timeout']:continue
        srj=json.loads((dataset/(directory.name+'.json')).read_text());mapping=json.loads(paths[1].read_text())
        result=ses_to_srj(paths[0],srj,mapping)
        result['experiment']={'algorithm':'freerouting','status':metadata['status'],'elapsedMs':metadata['runtimeMs'],'timeBudgetMs':metadata['timeBudgetSeconds']*1000,'nativeFinalState':metadata.get('nativeFinalState'),'provenance':'freerouting v2.5.0; SRJ-derived DSN; synthetic terminals recorded in mapping.json'}
        (directory/'routed.json').write_text(json.dumps(result))
        (root/(directory.name+'.json')).write_text(json.dumps(result))
        print(directory.name,metadata['status'],len(result['traces']))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--results',type=Path,default=Path('work/results/freerouting'));p.add_argument('--dataset',type=Path,default=Path('work/recorded/inputs'));args=p.parse_args();normalize(args.results,args.dataset)
