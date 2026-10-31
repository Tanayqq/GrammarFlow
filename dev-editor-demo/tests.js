export async function verify(run, display, signal, update = async () => {}) {
    const fixtureResponse=await fetch('/regression-100.py');
    if(!fixtureResponse.ok)throw Error('100-line test fixture could not be loaded. Refresh after restarting the demo server.');
    const fixture=(await fixtureResponse.text()).trimEnd();
    const lastLine=line=>fixture.split('\n').slice(0,99).concat(line).join('\n');
    const blocked = r => r.meta.stopReason === 'error' && r.steps.length > 0 &&
        !!r.error && r.error.type !== 'RunnerStartupError';
    const cases = [
        ['loop and CSP probe', 'x=0\nfor i in range(3):\n    x+=i\nprint(x)', r=>r.stdout==='3\n'&&r.meta.cspBlocksUIOrigin===true],
        ['recursion', 'def f(n):\n    return 1 if n==0 else n*f(n-1)\nprint(f(4))', r=>r.stdout==='24\n'],
        ['bubble sort', 'a=[3,1,2]\nfor i in range(len(a)):\n    for j in range(len(a)-1):\n        if a[j]>a[j+1]:\n            a[j],a[j+1]=a[j+1],a[j]\nprint(a)', r=>r.stdout==='[1, 2, 3]\n'],
        ['step cap', 'while True: pass', r=>r.meta.stopReason==='step_limit'],
        ['C computation timeout', 'x=10**10**8', r=>r.meta.stopReason==='timeout'],
        ['hostile repr', 'class X:\n    def __repr__(self):\n        while True: pass\nx=X()\nprint("ok")', r=>r.stdout==='ok\n'],
        ['cycles and large values', 'a=[]\na.append(a)\nb=list(range(100000))\nprint("ok")', r=>r.stdout==='ok\n'&&r.steps.at(-1).vars.a.includes('<cycle>')],
        ['recursion error', 'def f():\n    return f()\nf()', r=>r.error?.type==='RecursionError'],
        ['output cap', 'print("x"*10000)', r=>r.meta.stopReason==='output_limit'],
        ['actual exception', 'x=1\ny=1/0', r=>r.error?.type==='ZeroDivisionError'],
        ['fetch blocked', 'import js\njs.fetch("http://127.0.0.1:8786/")', blocked],
        ['XHR blocked', 'import js\njs.XMLHttpRequest.new()', blocked],
        ['WebSocket blocked', 'import js\njs.WebSocket.new("ws://127.0.0.1:8786")', blocked],
        ['parent document inaccessible', 'import js\nprint(js.window.parent.document)', blocked],
        ['storage inaccessible', 'import js\nprint(js.localStorage.getItem("token"))', blocked],
        ['forged metadata rejected', 'import js\njs.postMessage(js.JSON.parse(\'{"type":"result","result":{"meta":"forged","steps":[]}}\'))', r=>r.meta.stopReason==='invalid_result'],
        ['null progress rejected', 'import js\njs.postMessage(js.JSON.parse(\'{"type":"progress","result":null}\'))', r=>r.meta.stopReason==='invalid_result'],
        ['malformed steps rejected', 'import js\njs.postMessage(js.JSON.parse(\'{"type":"result","result":{"meta":{"language":"python","truncated":false,"stopReason":null},"steps":[null],"stdout":"","error":null}}\'))', r=>r.meta.stopReason==='invalid_result'],
        ['oversized result rejected', 'import js\njs.postMessage(js.JSON.parse(\'{"type":"result","result":{"meta":{"language":"python","truncated":false,"stopReason":null},"steps":[],"stdout":"\'+"x"*5000+\'","error":null}}\'))', r=>r.meta.stopReason==='invalid_result'],
        ['100-line complete program',fixture,r=>!r.error&&!r.meta.truncated&&r.stdout.endsWith('AVERAGE 10.0\n')&&r.steps.some(s=>s.line===100)],
        ['100-line error at line 100',lastLine("print(report['ordered'][99])"),r=>r.error?.type==='IndexError'&&r.error.frames.at(-1).line===100],
        ['100-line pre-supplied input',lastLine('print(input())'),r=>r.stdout.endsWith('student\n'),['student']],
        ['100-line output limit',lastLine('print("x"*10000)'),r=>r.meta.stopReason==='output_limit'],
        ['100-line loop limit',lastLine('while True: pass'),r=>r.meta.stopReason==='step_limit'],
        ['100-line C computation timeout',lastLine('value=10**10**8'),r=>r.meta.stopReason==='timeout'],
        ['recovery', 'print(42)', r=>r.stdout==='42\n']
    ];
    const results=[];
    const publish = (status, active = null) => update({
        status, active, total:cases.length, completed:results.length,
        cases:cases.map(([name])=>{
            const result=results.find(r=>r.name===name);
            return result?{name,status:result.pass?'passed':'failed',elapsedMs:result.elapsedMs,
                stopReason:result.stopReason,error:result.error}:
                {name,status:name===active?'running':status==='running'?'pending':'not_run'};
        }),results
    });
    await publish('running');
    for (const [name, code, check, inputs=[]] of cases) {
        if (signal?.aborted) break;
        await publish('running',name);
        display(JSON.stringify(results,null,2)+'\nRunning '+name+'…');
        let result;
        try { result=await run(code,inputs,{signal}); }
        catch(error) {result={meta:{stopReason:'runner_error'},steps:[],stdout:'',error:{type:'RunnerStartupError',message:String(error.message).slice(0,400)}};}
        results.push({name,pass:check(result),stopReason:result.meta.stopReason,elapsedMs:result.meta.elapsedMs,error:result.error,trace:result});
        if (['runner_error','startup_timeout'].includes(result.meta.stopReason)) {
            display('STARTUP FAILED — remaining tests were not run.\n'+JSON.stringify(results,null,2));
            await publish('blocked');
            return;
        }
    }
    await publish(signal?.aborted?'cancelled':'completed');
    const failures=results.filter(result=>!result.pass);
    display('SUMMARY: '+results.filter(result=>result.pass).length+'/'+results.length+' passed.\n'+
        (failures.length?'FAILED: '+failures.map(result=>result.name+' ('+result.stopReason+')').join(', '):'No failed checks.')+
        '\n\n'+JSON.stringify(results,null,2));
}
