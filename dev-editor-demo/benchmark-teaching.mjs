// Synthetic teaching evaluation, not a general accuracy guarantee.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
process.env.GRAMMARFLOW_LOCAL_DEMO='true';
if(!process.env.GROQ_API_KEY){console.error('Set GROQ_API_KEY in the process environment before running this optional live check.');process.exit(2);}
const {assist}=require('./assistant.cjs');
const paced=process.argv.includes('--paced');
const code=await readFile(new URL('./teaching-rust.rs',import.meta.url),'utf8');
const cases=[
 {name:'Rust imports and traits',mode:'lines',rangeStart:1,language:'Hinglish'},
 {name:'Rust stale entries and overflow',mode:'lines',rangeStart:41,language:'Hinglish'},
 {name:'Rust path reconstruction',mode:'lines',rangeStart:81,language:'Hinglish'},
 {name:'Rust Option early return',mode:'why',selectedLine:90,language:'Hinglish'},
 {name:'Rust priority queue purpose',mode:'why',selectedLine:37,language:'English'}
];
const results=[];
if(process.argv[2]!==undefined&&!paced&&(!/^\d+$/.test(process.argv[2])||Number(process.argv[2])>=cases.length))throw Error('Choose a valid benchmark case index or --paced.');
for(const sample of cases.filter((_,index)=>process.argv[2]===undefined||paced||index===Number(process.argv[2]))){
    const start=Date.now(),result=await assist({code,codeLanguage:'Rust',...sample},{localAdmission:false});
    results.push({name:sample.name,elapsedMs:Date.now()-start,...result});
    console.log(sample.name+': HTTP '+result.status);
    if(paced&&sample!==cases.at(-1))await new Promise(resolve=>setTimeout(resolve,30000));
}
const output=new URL('../../../outputs/Dev-Editor-Teaching-Evaluation'+(process.argv[2]===undefined||paced?'':'-'+Number(process.argv[2]))+'.json',import.meta.url);
await mkdir(new URL('./',output),{recursive:true});await writeFile(output,JSON.stringify(results,null,2));
if(results.some(result=>result.status!==200))process.exitCode=1;
