// Explicit allowlists prevent local configuration, reports and keys being shipped.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildApp} from './build-public.mjs';

const supplied=process.argv[2];
if(!supplied)throw Error('Supply the separate HTTPS static runtime origin.');
const origin=new URL(supplied);
if(origin.protocol!=='https:'||origin.origin!==supplied||
    origin.hostname==='grammarflowt.vercel.app'||origin.hostname==='grammarflow-brain.onrender.com')
    throw Error('Use a separate static HTTPS origin without a path or credentials.');
const output=new URL('./release/',import.meta.url);
const app=new URL('app/dev-editor/',output),runtime=new URL('runtime/vendor/',output);
await mkdir(app,{recursive:true});await mkdir(runtime,{recursive:true});
const manifest=JSON.parse(await readFile(new URL('./runtime-manifest.json',import.meta.url)));
for(const [name,hash] of Object.entries(manifest.files)){
    const data=await readFile(new URL('./vendor/'+name,import.meta.url));
    if(createHash('sha256').update(data).digest('hex')!==hash)throw Error('Runtime hash mismatch: '+name);
    await writeFile(new URL(name,runtime),data);
}
for(const name of ['PYODIDE-LICENSE.txt','PYTHON-LICENSE.txt','NOTICE.txt'])
    await copyFile(new URL('./notices/'+name,import.meta.url),new URL('../'+name,runtime));
await buildApp(app,supplied);
await writeFile(new URL('vercel.json',new URL('runtime/',output)),JSON.stringify({
    framework:null,installCommand:'',buildCommand:'',outputDirectory:'.',
    headers:[{source:'/(.*)',headers:[
        {key:'Access-Control-Allow-Origin',value:'*'},
        {key:'Cross-Origin-Resource-Policy',value:'cross-origin'},
        {key:'X-Content-Type-Options',value:'nosniff'},
        {key:'Cache-Control',value:'public, max-age=86400'},
        {key:'Content-Security-Policy',value:"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"}
    ]}]
},null,2));
console.log('Prepared static runtime and app assets in '+fileURLToPath(output));
console.log('Preserve upstream license notices before distributing the runtime.');
