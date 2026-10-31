import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadPyodide} from './vendor/pyodide.mjs';
const code=readFileSync(new URL('./regression-100.py',import.meta.url),'utf8').trimEnd();
assert.equal(code.split('\n').length,100);
const py=await loadPyodide({indexURL:fileURLToPath(new URL('./vendor/',import.meta.url))});
py.runPython(readFileSync(new URL('./recorder.py',import.meta.url),'utf8'));
const expected='TOTAL 50\nSORTED [5, 8, 10, 12, 15]\nRUNNING [12, 20, 25, 40, 50]\nFOUND 3\nMISSING -1\nFACTORIAL 24\nAVERAGE 10.0\n';
const results=[];
function check(name,source,test,inputs=[]){
    py.globals.set('_test_payload',JSON.stringify({code:source,inputs}));
    const trace=JSON.parse(py.runPython('run_json(_test_payload)'));
    test(trace);results.push({name,passed:true,steps:trace.steps.length,stopReason:trace.meta.stopReason});
    return trace;
}
const normal=check('100-line full program',code,r=>{assert.equal(r.stdout,expected);assert.equal(r.error,null);assert.equal(r.meta.truncated,false);assert.ok(r.steps.some(s=>s.line===100));assert.ok(r.steps.some(s=>s.stack.includes('factorial')));});
const changeLast=line=>code.split('\n').slice(0,99).concat(line).join('\n');
check('100-line captured error',changeLast("print(report['ordered'][99])"),r=>{assert.equal(r.error.type,'IndexError');assert.equal(r.error.frames.at(-1).line,100);});
check('100-line pre-supplied input',changeLast('print(input())'),r=>assert.ok(r.stdout.endsWith('student\n')),['student']);
check('100-line output cap',changeLast('print("x" * 10000)'),r=>{assert.equal(r.meta.stopReason,'output_limit');assert.match(r.stdout,/output truncated/);});
check('100-line infinite loop',changeLast('while True: pass'),r=>{assert.equal(r.meta.stopReason,'step_limit');assert.equal(r.steps.length,500);});
check('recovery after limits','print(42)',r=>assert.equal(r.stdout,'42\n'));
mkdirSync(new URL('../../../outputs/',import.meta.url),{recursive:true});
writeFileSync(new URL('../../../outputs/Dev-Editor-100-Line-Runtime.json',import.meta.url),JSON.stringify({lines:100,characters:code.length,results,trace:normal},null,2));
console.log(JSON.stringify({lines:100,normalSteps:normal.steps.length,checks:results}));
