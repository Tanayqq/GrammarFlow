// Real Pyodide/WASM checks under Node. Browser CSP/isolation require tests.js.
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {loadPyodide} from './vendor/pyodide.mjs';
const indexURL=fileURLToPath(new URL('./vendor/', import.meta.url));
const py=await loadPyodide({indexURL});
py.runPython(readFileSync(new URL('./recorder.py', import.meta.url),'utf8'));
py.runPython(readFileSync(new URL('./test_recorder.py', import.meta.url),'utf8')
    .replace('from recorder import record','').replace("if __name__ == '__main__':\n    unittest.main()",''));
console.log(py.runPython(`
suite = unittest.defaultTestLoader.loadTestsFromTestCase(RecorderTests)
result = unittest.TextTestRunner(verbosity=2).run(suite)
assert result.wasSuccessful()
str(result.testsRun) + ' recorder tests passed under Pyodide'
`));
const start=performance.now();
const worker=new Worker(`
const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
const {loadPyodide}=await import(workerData.module);
const py=await loadPyodide({indexURL:workerData.indexURL});
parentPort.postMessage('ready');
py.runPython('x=10**10**8');
parentPort.postMessage('unexpected completion');
})();`,{eval:true,workerData:{module:new URL('./vendor/pyodide.mjs',import.meta.url).href,indexURL}});
await new Promise((resolve,reject)=>{
    const startup=setTimeout(()=>{worker.terminate();reject(Error('startup timed out'));},30000);
    worker.once('error',reject);
    worker.once('message',message=>{
        clearTimeout(startup);
        if(message!=='ready') return reject(Error('unexpected message'));
        setTimeout(async()=>{await worker.terminate();resolve();},1000);
    });
});
console.log('Long C-level computation terminated externally; elapsed '+Math.round(performance.now()-start)+' ms');
console.log(py.runPython("record('print(42)')['stdout']") === '42\n' ? 'Recovery check passed' : 'FAILED');
