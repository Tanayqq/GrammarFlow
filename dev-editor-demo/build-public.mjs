import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export async function buildApp(app, supplied){
    const origin=new URL(supplied);
    if(origin.protocol!=='https:'||origin.origin!==supplied||
        ['grammarflowt.vercel.app','grammarflow-brain.onrender.com'].includes(origin.hostname))
        throw Error('A separate HTTPS static runtime origin is required.');
    await mkdir(app,{recursive:true});
    for(const name of ['runner.js','protocol.mjs','worker.mjs','recorder.py','dev-editor.css','dev-editor.mjs'])
        await copyFile(new URL(name,import.meta.url),new URL(name,app));
    let html=await readFile(new URL('./dev-editor.html',import.meta.url),'utf8');
    html=html.replaceAll('LOCAL BETA','BETA').replace('<a href="/">Runner verification ↗</a>','<a href="/">Back to workspace</a>')
        .replace('Local preview ·','Beta ·').replace('href="/dev-editor.css"','href="./dev-editor.css"')
        .replace('src="/dev-editor.mjs"','src="./dev-editor.mjs"').replace('href="/dev-editor.html"','href="./"');
    await writeFile(new URL('index.html',app),html);
    const js=await readFile(new URL('dev-editor.mjs',app),'utf8');
    await writeFile(new URL('dev-editor.mjs',app),js.replace("fetch('/assist'","fetch('/api/v1/dev-editor/assist'").replace("fetch('/execute'","fetch('/api/v1/dev-editor/execute'"));
    await writeFile(new URL('runtime-config.mjs',app),`export const runtimeOrigin=${JSON.stringify(supplied)};\n`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
    await buildApp(new URL('../public/dev-editor/',import.meta.url),'https://grammarflow-python-runtime.vercel.app');
