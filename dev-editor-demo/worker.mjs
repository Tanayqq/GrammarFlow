(async () => {
// This worker is created in an opaque sandbox, never in the application origin.
const send = self.postMessage.bind(self);
let py;
// Test the CSP itself, not merely the removed global function names. No secrets
// are sent, and this request should be rejected before it reaches the UI origin.
let cspBlocksUIOrigin = false;
let startupStage = 'csp_probe';
try {
    try {
        await fetch(uiOrigin+'/', {credentials: 'omit'});
    } catch {
        cspBlocksUIOrigin = true;
    }
    if (!cspBlocksUIOrigin) throw new Error('Runner CSP did not block the UI origin');
    startupStage = 'runtime_import';
    const {loadPyodide} = await import(runtimeOrigin+'/vendor/pyodide.mjs');
    startupStage = 'runtime_load';
    py = await loadPyodide({ indexURL: runtimeOrigin+'/vendor/' });
} catch (error) {
    send({type: 'failed', result: {stage: startupStage, message: String(error.message || error).slice(0,400)}});
}
let used = false;
self.onmessage = ({data}) => {
    if (used || data?.type !== 'run') return;
    used = true;
    // Defense in depth. CSP + opaque origin are the security boundary.
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport',
        'EventSource', 'importScripts', 'Worker', 'SharedWorker', 'BroadcastChannel']) {
        Object.defineProperty(self, name, {value: undefined, writable: false, configurable: false});
    }
    try {
        py.runPython(data.recorder);
        py.globals.set('_gf_emit', step => send({type: 'progress', result: JSON.parse(step)}));
        py.globals.set('_gf_payload', JSON.stringify({code: data.code, inputs: data.inputs}));
        const result = py.runPython('run_json(_gf_payload, _gf_emit)');
        const trace = JSON.parse(result);
        trace.meta.cspBlocksUIOrigin = cspBlocksUIOrigin;
        send({type: 'result', result: trace});
    } catch {
        send({type: 'failed'});
    }
};
if (py) send({type: 'ready'});

})();
