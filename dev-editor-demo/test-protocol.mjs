import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeResult} from './protocol.mjs';
const good={meta:{language:'python',truncated:false,stopReason:null},steps:[],stdout:'42\n',error:null};
const report=JSON.parse(readFileSync(new URL('./test-fixture.json',import.meta.url),'utf8'));
for(const item of report.results)assert.ok(normalizeResult(item.trace),item.name);
let active, removed=false, handler;
globalThis.location={origin:'http://127.0.0.1:8786'};
globalThis.window={addEventListener:(name,fn)=>handler=fn,removeEventListener:()=>{handler=null;}};
globalThis.fetch=async()=>({ok:true,text:async()=>''});
globalThis.document={createElement:()=>{const frame={remove:()=>{removed=true;},contentWindow:{postMessage:data=>{
    queueMicrotask(()=>handler({source:frame.contentWindow,data:{channel:data.channel,...active}}));
}}};return frame;},body:{append:frame=>frame.onload()}};
const {run}=await import('./runner.js');
const bad=[{meta:'forged',steps:[]},{...good,meta:null},{...good,steps:[null]},
    {...good,stdout:'x'.repeat(5000)},{...good,steps:'bad'}];
for(const result of bad){
    removed=false;active={type:'result',result};
    const output=await run('print(42)');
    assert.equal(output.meta.stopReason,'invalid_result');assert.equal(removed,true);
}
active={type:'progress',result:null};assert.equal((await run('pass')).meta.stopReason,'invalid_result');
active={type:'result',result:good};assert.equal((await run('print(42)')).stdout,'42\n');
console.log(`${report.results.length} captured traces accepted; malformed worker results/progress terminate and the next run recovers.`);
