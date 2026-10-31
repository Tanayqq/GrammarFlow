import {mkdir,readFile,writeFile} from 'node:fs/promises';
const code=(await readFile(new URL('./regression-100.py',import.meta.url),'utf8')).trimEnd();
const errorCode=code.split('\n').slice(0,99).concat("print(report['ordered'][99])").join('\n');
const cases=[];
for(const language of ['English','Hinglish']){
    cases.push({name:`100-line explanation ${language}`,code,language,mode:'explain',steps:[],error:null});
    cases.push({name:`Line 100 explanation ${language}`,code,language,mode:'why',selectedLine:100,steps:[],error:null});
    cases.push({name:`Line 100 error ${language}`,code:errorCode,language,mode:'error',steps:[],error:{type:'IndexError',message:'list index out of range',frames:[{line:100,function:'<module>'}]}});
}
const results=[];
await mkdir(new URL('../../../outputs/',import.meta.url),{recursive:true});
for(const item of cases){
    const started=performance.now();
    const response=await fetch('http://127.0.0.1:8786/assist',{method:'POST',headers:{Origin:'http://127.0.0.1:8786','Content-Type':'application/json'},body:JSON.stringify(item),signal:AbortSignal.timeout(45000)});
    const body=await response.json();results.push({name:item.name,status:response.status,success:body.success,elapsedMs:Math.round(performance.now()-started),answer:body.data||body.error?.message});
    console.log(JSON.stringify(results.at(-1)));
    await writeFile(new URL('../../../outputs/Dev-Editor-100-Line-AI.json',import.meta.url),JSON.stringify(results,null,2));
    await new Promise(resolve=>setTimeout(resolve,3200));
}
