// Real browser check of packaged assets, using an isolated temporary profile.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {default:puppeteer}=await import(pathToFileURL(process.argv[2]).href);
const types={html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',py:'text/plain'};
const assets=new Set(['runner.js','protocol.mjs','worker.mjs','recorder.py','runtime-config.mjs','dev-editor.css','dev-editor.mjs']);
const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname.slice(1);
    let file;
    if(path==='')file=new URL('./index.html',import.meta.url);
    else if(path==='workspace')file=new URL('./release/app/dev-editor/index.html',import.meta.url);
    else if(assets.has(path))file=new URL('./release/app/dev-editor/'+path,import.meta.url);
    else if(['tests.js','regression-100.py'].includes(path))file=new URL('./'+path,import.meta.url);
    else {res.writeHead(404);res.end();return;}
    try{res.setHeader('Content-Type',types[file.pathname.split('.').at(-1)]);res.end(await readFile(file));}
    catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
    browser=await puppeteer.launch({executablePath:process.argv[3],headless:true});
    const page=await browser.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    if(process.argv[4]!=='--workspace-only'){
    const report=await page.evaluate(async()=>{
        const {run}=await import('./runner.js');const {verify}=await import('./tests.js');
        let latest;await verify(run,()=>{},undefined,report=>{latest=report;});return latest;
    });
    const output=new URL('./release/Dev-Editor-Release-Browser.json',import.meta.url);
    await mkdir(new URL('./',output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2));
    assert.equal(report.status,'completed');assert.equal(report.results.length,26);
    assert.deepEqual(report.results.filter(item=>!item.pass).map(item=>item.name),[]);
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/workspace`);
    await page.click('#run');
    await page.waitForFunction(()=>document.querySelector('#run-state').textContent.includes('Completed'));
    await page.$eval('#timeline',node=>{node.value=node.max;node.dispatchEvent(new Event('input'));});
    assert.match(await page.$eval('#stdout',node=>node.textContent),/3/);
    await page.screenshot({path:fileURLToPath(new URL('./release/Dev-Editor-Release-Desktop.png',import.meta.url)),fullPage:true});
    console.log('Packaged workspace execution passed against HTTPS runtime; see the saved 26-case browser report.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
