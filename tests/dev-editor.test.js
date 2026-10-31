const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const load=require('./load-module');

test('Dev Editor API validates input, uses the existing limiter and disables local admission',async()=>{
    const routes=[];let limits=0,called=0;
    const router={use(){},get(){},delete(){},post(path,...handlers){if(path==='/dev-editor/assist')routes.push(handlers);}};
    const pass=(req,res,next)=>next();
    const assistant={requestFor(body){if(!body?.code)throw Error('invalid');},async assist(body,options){
        called++;assert.equal(options.localAdmission,false);return {status:200,body:{success:true,data:'Explanation'}};
    }};
    load('src/routes/ai.routes.js',{
        express:{Router:()=>router},'../controllers/ai.controller':{},
        '../middlewares/rateLimiter':{aiLimiter:(req,res,next)=>{limits++;next();},executionLimiter:pass},
        '../middlewares/auth':{passiveAuth:pass},'./auth.routes':{},'../middlewares/validateAIInput':pass,
        '../../dev-editor-demo/assistant.cjs':assistant
    });
    assert.equal(routes.length,1);
    const app=express();app.use(express.json());app.post('/assist',...routes[0]);
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    try{
        const url=`http://127.0.0.1:${server.address().port}/assist`;
        const post=body=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const bad=await post({});assert.equal(bad.status,400);assert.equal(called,0);
        const good=await post({code:'print(42)'});assert.equal(good.status,200);
        assert.equal(good.headers.get('cache-control'),'no-store');assert.equal(called,1);assert.equal(limits,2);
    }finally{await new Promise(resolve=>server.close(resolve));}
});
