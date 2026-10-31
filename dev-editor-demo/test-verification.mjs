import assert from 'node:assert/strict';
import {verify} from './tests.js';
import {readFileSync} from 'node:fs';
globalThis.fetch=async()=>({ok:true,text:async()=>readFileSync(new URL('./regression-100.py',import.meta.url),'utf8')});
let count=0, report='', tracked;
await verify(async()=>{
    count++;
    return {meta:{stopReason:'runner_error'},steps:[],stdout:'',error:{type:'RunnerStartupError'}};
},text=>report=text,undefined,value=>{tracked=value;});
assert.equal(count,1);
assert.match(report,/STARTUP FAILED/);
assert.equal(JSON.parse(report.slice(report.indexOf('[')))[0].pass,false);
assert.equal(tracked.cases.length,26);
assert.equal(tracked.cases[0].status,'failed');
assert.equal(tracked.cases.filter(item=>item.status==='not_run').length,25);
console.log('Startup failure is reported as failure; remaining browser tests are not run.');
