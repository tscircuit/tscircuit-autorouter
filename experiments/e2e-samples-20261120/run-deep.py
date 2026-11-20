from pathlib import Path
import json,os,subprocess,sys,time

sample,out=sys.argv[1:]
root=Path(out);root.mkdir(parents=True,exist_ok=True)
started=time.monotonic()
with (root/'worker.log').open('w') as log:
    try:
        process=subprocess.run(['bun','--preload','./intercept-internals.ts','worker-deep.tsx',sample,str(root.resolve())],stdout=log,stderr=subprocess.STDOUT,timeout=660)
        result={'sample':sample,'exitCode':process.returncode,'timedOut':False}
    except subprocess.TimeoutExpired:
        result={'sample':sample,'exitCode':None,'timedOut':True}
result['wallMs']=(time.monotonic()-started)*1000
(root/'process.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
if (root/'report.json').exists():print('E2E_REPORT', (root/'report.json').read_text())
else:print((root/'worker.log').read_text()[-12000:])
