const {test}=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-module');
const base={code:'print(42)',codeLanguage:'Python',inputs:[]};
const token='12345678-1234-1234-1234-123456789abc';
const json=value=>new Response(JSON.stringify(value));
const moduleFor=fetch=>load('src/services/execution.service.js',{}, {fetch,AbortSignal,process:{env:{}}});
test('all 12 languages use fixed remote runtimes and cannot override host or security limits',async()=>{
    const requests=[];
    const service=moduleFor(async(url,options)=>{requests.push({url,options});return json(options.method==='POST'?{token}:{status:{id:3},stdout:Buffer.from('42\n').toString('base64'),time:'0.01'});});
    assert.equal(Object.keys(service.languageIds).length,12);
    for(const codeLanguage of Object.keys(service.languageIds)){
        const result=await service.execute({...base,codeLanguage,url:'http://127.0.0.1/private',enable_network:true});
        assert.equal(result.status,200);assert.equal(result.body.data.stdout,'42\n');
        assert.equal(result.body.data.executionKind,'remote');assert.equal(result.body.data.error,null);
    }
    for(const {url,options}of requests){assert.ok(url.startsWith('https://ce.judge0.com/'));assert.equal(options.redirect,'error');
        if(options.method==='POST'){const body=JSON.parse(options.body);assert.equal(body.enable_network,false);assert.equal(body.cpu_time_limit,2);assert.equal(body.wall_time_limit,5);assert.equal(body.number_of_runs,1);}
    }
});
test('compiler errors, runtime errors, timeouts, output bounds and infrastructure failure are distinguished',async()=>{
    for(const [id,type]of [[6,'CompilationError'],[11,'ExecutionError'],[5,'TimeLimitExceeded']]){
        const service=moduleFor(async(url,options)=>json(options.method==='POST'?{token}:{status:{id},stderr:Buffer.from('diagnostic').toString('base64')}));
        const result=await service.execute(base);assert.equal(result.body.data.error.type,type);assert.equal(result.body.data.error.message,'diagnostic');
    }
    const big=moduleFor(async(url,options)=>json(options.method==='POST'?{token}:{status:{id:3},stdout:Buffer.from('x'.repeat(15000)).toString('base64')}));
    const output=(await big.execute(base)).body.data;assert.equal(output.stdout.length,12000);assert.equal(output.outputMayBeTruncated,true);
    const failure=moduleFor(async()=>new Response('private provider detail',{status:429}));
    const response=await failure.execute(base);assert.equal(response.status,503);assert.ok(!JSON.stringify(response).includes('private provider detail'));
    const invalid=moduleFor(async()=>json({token:'../../private'}));assert.equal((await invalid.execute(base)).status,503);
});
test('execution rejects invalid languages, oversized programs and inputs before sending code',()=>{
    const service=moduleFor(()=>{throw Error('Must not call provider');});
    for(const body of [{...base,codeLanguage:'Bash'},{...base,code:'x'.repeat(60001)},{...base,inputs:['x'.repeat(1001)]},{...base,code:'x\n'.repeat(1000)}])assert.throws(()=>service.validate(body));
});
test('runner admission is bounded and recovers when active jobs finish',async()=>{
    const waiting=[];let released=false;
    const service=moduleFor(async(url,options)=>{
        if(options.method==='POST'){if(!released)await new Promise(resolve=>waiting.push(resolve));return json({token});}
        return json({status:{id:3},stdout:Buffer.from('ok').toString('base64')});
    });
    const first=service.execute(base),second=service.execute(base);
    assert.equal((await service.execute(base)).status,503);assert.equal(waiting.length,2);
    released=true;waiting.forEach(resolve=>resolve());
    assert.deepEqual((await Promise.all([first,second])).map(result=>result.status),[200,200]);
    assert.equal((await service.execute(base)).status,200);
});

test('execution HTTP route validates before provider calls and uses its own limiter',async()=>{
    const express=require('express'),pass=(req,res,next)=>next();let calls=0,limits=0;
    const service={validate(body){if(!body?.code)throw Error('bad');},async execute(){calls++;return {status:200,body:{success:true,data:{stdout:'42\n'}}};}};
    const router=load('src/routes/ai.routes.js',{
        '../controllers/ai.controller':new Proxy({},{get:()=>pass}),
        '../middlewares/rateLimiter':{aiLimiter:pass,docLimiter:pass,readLimiter:pass,executionLimiter:(req,res,next)=>{limits++;next();}},
        '../middlewares/auth':{passiveAuth:pass},'./auth.routes':express.Router(),'../middlewares/validateAIInput':pass,
        '../services/execution.service':service
    },{AbortController});
    const app=express();app.use(express.json());app.use(router);
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    try{
        const post=body=>fetch(`http://127.0.0.1:${server.address().port}/dev-editor/execute`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        assert.equal((await post({})).status,400);assert.equal(calls,0);
        const good=await post(base);assert.equal(good.status,200);assert.equal(good.headers.get('cache-control'),'no-store');
        assert.equal(calls,1);assert.equal(limits,2);
    }finally{await new Promise(resolve=>server.close(resolve));}
});
