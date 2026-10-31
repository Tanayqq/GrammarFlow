// Real synthetic smoke tests; no user code or credentials are written.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{execute}=require('../src/services/execution.service');
const ui=await readFile(new URL('./dev-editor.mjs',import.meta.url),'utf8');
const examples=JSON.parse(ui.match(/const languageExamples=(\{[^\n]+\});/)[1]);
const results=[];
for(const [codeLanguage,code]of Object.entries(examples)){
    const result=await execute({code,codeLanguage,inputs:[]});
    results.push({language:codeLanguage,httpStatus:result.status,...result.body});
    console.log(codeLanguage+': HTTP '+result.status+' / '+(result.body.data?.status||'unavailable')+' / '+JSON.stringify(result.body.data?.stdout));
}
const output=new URL('../../../outputs/Dev-Editor-Execution-Smoke.json',import.meta.url);
await mkdir(new URL('./',output),{recursive:true});await writeFile(output,JSON.stringify(results,null,2));
if(results.some(result=>result.httpStatus!==200||result.data.status!=='Completed'))process.exitCode=1;
