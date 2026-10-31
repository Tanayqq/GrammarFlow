// Local-only static servers. Never serve app files or production credentials.
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assistant from './assistant.cjs';
import dotenv from 'dotenv';
process.env.GRAMMARFLOW_LOCAL_DEMO='true';
// Reuse the user's existing local Groq setup without copying the key to another
// file. Neither origin serves configuration files; only explicit assets exist.
if(!process.env.GROQ_API_KEY){
    try{
        const config=dotenv.parse(await readFile(new URL('../../mirofish/.env',import.meta.url)));
        if(config.GROQ_API_KEY)process.env.GROQ_API_KEY=config.GROQ_API_KEY;
        else if(new URL(config.LLM_BASE_URL||'').hostname==='api.groq.com'&&config.LLM_API_KEY)
            process.env.GROQ_API_KEY=config.LLM_API_KEY;
    }catch{/* Optional AI remains unavailable if no compatible local config exists. */}
}
const reportPath = new URL('../../../outputs/Dev-Editor-Verification.json',import.meta.url);
const demoFiles = new Set(['index.html','runner.js','worker.mjs','recorder.py','tests.js','protocol.mjs','runtime-config.mjs','dev-editor.html','dev-editor.mjs','dev-editor.css','regression-100.py']);
const runtimeFiles = new Set(['pyodide.mjs','pyodide.asm.mjs','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json']);
const types = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript',mjs:'text/javascript',py:'text/plain',wasm:'application/wasm',zip:'application/zip',json:'application/json'};
function serve(port, runtime) {
    const server=createServer(async(req,res)=>{
        const path=(req.url||'/').split('?')[0];
        if(!runtime && path==='/assist'){
            if(req.method!=='POST'||req.headers.host!=='127.0.0.1:8786'||req.headers.origin!=='http://127.0.0.1:8786'||req.headers['content-type']!=='application/json'){
                res.writeHead(403);res.end();return;
            }
            try{
                const chunks=[];let bytes=0;
                for await(const chunk of req){bytes+=chunk.length;if(bytes>60000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
                const result=await assistant.assist(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                res.writeHead(result.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result.body));
            }catch{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,error:{message:'Invalid explanation request.'}}));}
            return;
        }
        if (!runtime && path==='/test-results') {
            res.setHeader('Cache-Control','no-store');
            if(req.headers.host!=='127.0.0.1:8786'){res.writeHead(403);res.end();return;}
            if(req.method==='GET'){
                try{res.setHeader('Content-Type','application/json');res.end(await readFile(reportPath));}
                catch{res.writeHead(404);res.end('No verification run recorded yet.');}
                return;
            }
            if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:8786'||req.headers['content-type']!=='application/json'){
                res.writeHead(403);res.end();return;
            }
            try {
                const chunks=[];let bytes=0;
                for await(const chunk of req){bytes+=chunk.length;if(bytes>8000000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
                const report=JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if(!Number.isInteger(report.total)||report.total<1||report.total>32||!Array.isArray(report.cases)||report.cases.length!==report.total||
                    !Array.isArray(report.results)||report.results.length>report.total||
                    !['running','completed','blocked','cancelled'].includes(report.status))throw Error('Invalid report');
                report.savedAt=new Date().toISOString();
                await mkdir(new URL('./',reportPath),{recursive:true});
                await writeFile(reportPath,JSON.stringify(report,null,2));
                res.writeHead(204);res.end();
            }catch{res.writeHead(400);res.end('Invalid test report');}
            return;
        }
        const name=path==='/'?'index.html':path.slice(1);
        const allowed=runtime?name.startsWith('vendor/')&&runtimeFiles.has(name.slice(7)):demoFiles.has(name);
        if(!['GET','HEAD'].includes(req.method)||!allowed){res.writeHead(404);res.end();return;}
        try {
            const data=await readFile(new URL(name,import.meta.url));
            res.writeHead(200,{'Content-Type':types[name.split('.').at(-1)]||'application/octet-stream',
                'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin',
                'X-Content-Type-Options':'nosniff','Cache-Control':runtime?'public, max-age=86400':'no-store'});
            res.end(req.method==='HEAD'?undefined:data);
        } catch {res.writeHead(404);res.end();}
    });
    server.on('error',error=>{console.error(`Could not start port ${port}: ${error.code}`);process.exit(1);});
    return new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
}
await Promise.all([serve(8786,false),serve(8787,true)]);
console.log('Dev Editor demo ready: http://127.0.0.1:8786');
