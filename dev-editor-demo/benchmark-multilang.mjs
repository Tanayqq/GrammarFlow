// Explicit synthetic provider check; no user source or credentials are written.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),dotenv=require('dotenv');
process.env.GRAMMARFLOW_LOCAL_DEMO='true';
if(!process.env.GROQ_API_KEY){
    const config=dotenv.parse(await readFile(new URL('../../mirofish/.env',import.meta.url)));
    if(new URL(config.LLM_BASE_URL||'').hostname==='api.groq.com')process.env.GROQ_API_KEY=config.LLM_API_KEY;
}
const {assist}=require('./assistant.cjs');
const samples=[
 {name:'JavaScript lines',codeLanguage:'JavaScript',language:'English',mode:'lines',rangeStart:1,code:'const numbers = [1, 2, 3];\nlet total = 0;\nfor (const number of numbers) {\n  total += number;\n}\nconsole.log(total);'},
 {name:'Java selected line 200',codeLanguage:'Java',language:'English',mode:'why',selectedLine:200,code:Array.from({length:200},(_,i)=>i===0?'class Example {':i===199?'  int result = 200;':`  int value${i} = ${i};`).concat('}').join('\n')},
 {name:'C++ Hinglish lines',codeLanguage:'C++',language:'Hinglish',mode:'lines',rangeStart:1,code:'#include <iostream>\nint main() {\n  int total = 0;\n  for (int i = 1; i <= 3; ++i) {\n    total += i;\n  }\n  std::cout << total;\n}'},
 {name:'Python 1000-line excerpt',codeLanguage:'Python',language:'English',mode:'lines',rangeStart:991,code:Array.from({length:1000},(_,i)=>`value_${i+1} = ${i+1}  # demonstration assignment ${i+1}`).join('\n')}
];
const results=[];
for(const sample of samples){
    const start=Date.now(),result=await assist(sample,{localAdmission:false});
    results.push({name:sample.name,status:result.status,elapsedMs:Date.now()-start,...result.body});
    console.log(sample.name+': HTTP '+result.status);
}
const output=new URL('../../../outputs/Dev-Editor-Multilanguage-AI.json',import.meta.url);
await mkdir(new URL('./',output),{recursive:true});await writeFile(output,JSON.stringify(results,null,2));
if(results.some(result=>result.status!==200))process.exitCode=1;
