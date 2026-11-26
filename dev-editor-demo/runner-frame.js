// Controller of the isolated Python runner. It is a page of its own so it can have its own security policy:
// an iframe built from srcdoc inherits the site's strict policy, which blocks Python. It always runs sandboxed
// (opaque origin), so it cannot read the app's storage or cookies.
addEventListener('message', function start(event) {
    // Only the app page that embeds this frame may start it, once.
    if (event.source !== parent || event.origin !== new URL(location.href).origin || !event.data?.channel) return;
    removeEventListener('message', start);
    const data = event.data;
    const {channel, runtimeOrigin} = data;
    const relay = (type, result) => parent.postMessage({channel, type, result}, '*');
    let worker, timer;
    try {
        if (new URL(runtimeOrigin).origin !== runtimeOrigin) throw new Error('Invalid runtime origin');
        // Narrows the policy further, also on servers that send no headers. The worker inherits it.
        // Pyodide's Emscripten bridge needs eval.
        const policy = document.createElement('meta');
        policy.httpEquiv = 'Content-Security-Policy';
        policy.content = `default-src 'none'; script-src blob: ${runtimeOrigin} 'unsafe-eval' 'wasm-unsafe-eval'; worker-src blob:; connect-src ${runtimeOrigin}; base-uri 'none'; form-action 'none'`;
        document.head.append(policy);
        // A classic bootstrap can start from blob:null in the opaque frame.
        // The bootstrap dynamically imports the ES-module Pyodide runtime.
        worker = new Worker(URL.createObjectURL(new Blob([data.workerSource], {type:'text/javascript'})));
    } catch (error) {
        relay('failed', {stage:'worker_create', message:String(error.message).slice(0,400)}); return;
    }
    worker.onerror = failure => {clearTimeout(timer); worker.terminate(); relay('failed', {stage:'worker_load', message:failure.message || 'Worker module loading failed'});};
    worker.onmessage = ({data: message}) => {
        if (message.type === 'ready') {
            relay('ready');
            timer = setTimeout(() => {worker.terminate(); relay('timeout');}, data.timeoutMs);
            worker.postMessage({type:'run', code:data.code, inputs:data.inputs, recorder:data.recorder});
        } else if (message.type === 'progress') {
            relay('progress', message.result);
        } else if (message.type === 'result' || message.type === 'failed') {
            clearTimeout(timer); worker.terminate(); relay(message.type, message.result);
        }
    };
});
