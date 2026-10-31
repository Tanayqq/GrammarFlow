// Synthetic examples only. Never benchmark with a user's private code.
import {mkdir,writeFile} from 'node:fs/promises';
const code='total = 0\nfor i in range(3):\n    total += i\nprint(total)';
const cases=[
    {name:'Loop explanation — English',code,language:'English',mode:'explain',steps:[],error:null},
    {name:'Loop explanation — Hinglish',code,language:'Hinglish',mode:'explain',steps:[],error:null},
    {name:'Real IndexError — English',code:'numbers = [10, 20, 30]\nprint(numbers[3])',language:'English',mode:'error',steps:[],error:{type:'IndexError',message:'list index out of range',frames:[{line:2,function:'<module>'}]}},
    {name:'Recorded change — Hinglish',code,language:'Hinglish',mode:'why',selectedLine:2,steps:[{line:2,event:'line',changed:['total'],vars:{total:'3'},causedBy:3}],error:null}
];
const results=[];
for(const item of cases){
    const start=performance.now();
    const response=await fetch('http://127.0.0.1:8786/assist',{method:'POST',headers:{Origin:'http://127.0.0.1:8786','Content-Type':'application/json'},body:JSON.stringify(item),signal:AbortSignal.timeout(25000)});
    const data=await response.json();
    const result={name:item.name,status:response.status,elapsedMs:Math.round(performance.now()-start),success:data.success,response:data.data||data.error?.message};
    results.push(result);console.log(JSON.stringify(result));
    await new Promise(resolve=>setTimeout(resolve,3200));
}
await mkdir(new URL('../../../outputs/',import.meta.url),{recursive:true});
await writeFile(new URL('../../../outputs/Dev-Editor-AI-Benchmark.json',import.meta.url),JSON.stringify(results,null,2));
