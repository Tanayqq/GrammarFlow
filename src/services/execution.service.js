// User programs are submitted to Judge0, never executed in the app process.
const languageIds={Python:113,JavaScript:102,TypeScript:101,Java:91,C:103,'C++':105,'C#':51,Go:107,Rust:108,PHP:98,Ruby:72,SQL:82};
function validate(body){
    if(!body||!Object.hasOwn(languageIds,body.codeLanguage)||typeof body.code!=='string'||!body.code.trim()||body.code.length>60000||
        body.code.split('\n').length>1000||!Array.isArray(body.inputs)||body.inputs.length>50||
        body.inputs.some(value=>typeof value!=='string'||value.length>1000))throw Error('Invalid execution request.');
    return body;
}
let active=0;
async function execute(body,{signal}={}){
    validate(body);
    // ponytail: shared beta service; use a dedicated Judge0 instance at higher volume.
    if(active>=2)return {status:503,body:{success:false,error:{message:'The code runner is busy. Please try again shortly; your code is unchanged.'}}};
    active++;
    try{
        const origin=new URL(process.env.JUDGE0_URL||'https://ce.judge0.com');
        if(origin.protocol!=='https:'||origin.origin!==origin.href.replace(/\/$/,'')||origin.username||origin.password)throw Error('Invalid execution host');
        const headers={'Content-Type':'application/json'};
        if(process.env.JUDGE0_API_KEY){
            if(origin.hostname.endsWith('.p.rapidapi.com')){headers['X-RapidAPI-Key']=process.env.JUDGE0_API_KEY;headers['X-RapidAPI-Host']=origin.hostname;}
            else headers['X-Auth-Token']=process.env.JUDGE0_API_KEY;
        }
        const deadline=AbortSignal.timeout(25000),requestSignal=signal?AbortSignal.any([signal,deadline]):deadline;
        async function request(path,options={}){
            const response=await fetch(origin.origin+path,{...options,headers,signal:requestSignal,redirect:'error'});
            if(!response.ok)throw Error('Execution service unavailable');
            const chunks=[];let bytes=0;
            for await(const chunk of response.body){bytes+=chunk.length;if(bytes>262144)throw Error('Execution response too large');chunks.push(chunk);}
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }
        const submitted=await request('/submissions?base64_encoded=true&wait=false',{method:'POST',body:JSON.stringify({
            language_id:languageIds[body.codeLanguage],source_code:Buffer.from(body.code).toString('base64'),
            stdin:Buffer.from(body.inputs.join('\n')+(body.inputs.length?'\n':'')).toString('base64'),
            cpu_time_limit:2,cpu_extra_time:0.5,wall_time_limit:5,memory_limit:256000,
            max_file_size:64,enable_network:false,number_of_runs:1
        })});
        if(typeof submitted.token!=='string'||!/^[a-f0-9-]{36}$/.test(submitted.token))throw Error('Invalid submission');
        let result;
        for(let i=0;i<28;i++){
            result=await request(`/submissions/${submitted.token}?base64_encoded=true&fields=stdout,stderr,compile_output,status,time,memory`);
            if(![1,2].includes(result.status?.id))break;
            await require('node:timers/promises').setTimeout(600,undefined,{signal:requestSignal});
        }
        if(!Number.isInteger(result?.status?.id)||result.status.id<3||result.status.id>12)throw Error('Execution not completed');
        const decode=value=>typeof value==='string'?Buffer.from(value,'base64').toString('utf8').slice(0,12000):'';
        const stdout=decode(result.stdout),stderr=decode(result.stderr),compileOutput=decode(result.compile_output);
        const type=result.status.id===6?'CompilationError':result.status.id===5?'TimeLimitExceeded':'ExecutionError';
        return {status:200,body:{success:true,data:{
            language:body.codeLanguage,executionKind:'remote',stdout,stderr,compileOutput,
            status:result.status.id===3?'Completed':type,
            error:result.status.id===3?null:{type,message:(compileOutput||stderr||type).slice(0,400),frames:[]},
            executionMs:Number.isFinite(Number(result.time))?Math.max(0,Math.round(Number(result.time)*1000)):null,
            outputMayBeTruncated:result.status.id===8||[stdout,stderr,compileOutput].some(value=>value.length===12000)
        }}};
    }catch{return {status:503,body:{success:false,error:{message:'The external code runner is temporarily unavailable. Your code is unchanged. You can still use source explanations.'}}};}
    finally{active--;}
}
module.exports={execute,validate,languageIds};
