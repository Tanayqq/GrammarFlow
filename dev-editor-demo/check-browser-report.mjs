import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const report=JSON.parse(readFileSync(new URL('../../../outputs/Dev-Editor-Verification.json',import.meta.url),'utf8'));
assert.equal(report.status,'completed');
assert.equal(report.results.length,report.total);
let snapshots=0;
for(const result of report.results){
    assert.equal(result.pass,true,result.name);
    const frames=new Map();
    for(const step of result.trace.steps){
        const key=JSON.stringify(step.stack);
        const previous=frames.get(key)||{};
        assert.deepEqual(step.changed,Object.keys(step.vars).filter(name=>step.vars[name]!==previous[name]),result.name+' changed variables');
        assert.deepEqual(step.deleted,Object.keys(previous).filter(name=>!(name in step.vars)),result.name+' deleted variables');
        for(const value of Object.values(step.vars))assert.ok(typeof value==='string'&&value.length<=220);
        if(step.event==='return')frames.delete(key);else frames.set(key,step.vars);
        snapshots++;
    }
}
const byName=Object.fromEntries(report.results.map(item=>[item.name,item.trace]));
assert.equal(byName['loop and CSP probe'].stdout,'3\n');
assert.equal(byName.recursion.stdout,'24\n');
assert.equal(byName['bubble sort'].steps.at(-1).vars.a,'[1, 2, 3]');
assert.equal(byName['step cap'].steps.length,500);
assert.ok(byName['C computation timeout'].steps.length>0);
assert.match(byName['output cap'].stdout,/\[output truncated\]/);
assert.equal(byName.recovery.stdout,'42\n');
console.log(`${report.total} browser cases passed; ${snapshots} recorded snapshots have consistent variable diffs and bounded previews.`);
