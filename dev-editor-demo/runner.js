import {normalizeResult,validStep} from './protocol.mjs';
import {runtimeOrigin} from './runtime-config.mjs';
export async function run(code, inputs = [], {timeoutMs = 3000, signal} = {}) {
    if (typeof code !== 'string' || code.length > 12000 || !Array.isArray(inputs) ||
        inputs.length > 50 || inputs.some(x => typeof x !== 'string' || x.length > 1000)) {
        throw new Error('Use at most 12,000 code characters and 50 short input lines.');
    }
    timeoutMs = Number.isFinite(timeoutMs) ? Math.max(500, Math.min(timeoutMs, 5000)) : 3000;
    const loadSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
    const load = async path => {
        const response = await fetch(path, {signal: loadSignal});
        if (!response.ok) throw new Error('Demo file could not be loaded: ' + path);
        return response.text();
    };
    const [workerSource, recorder] = await Promise.all([
        load(new URL('./worker.mjs',import.meta.url)), load(new URL('./recorder.py',import.meta.url))
    ]);
    const configuredOrigin = new URL(runtimeOrigin);
    if (configuredOrigin.origin !== runtimeOrigin ||
        !(configuredOrigin.protocol === 'https:' || runtimeOrigin === 'http://127.0.0.1:8787') ||
        configuredOrigin.origin === location.origin) throw new Error('A separate static Python runtime is required.');
    const bootstrap = `const runtimeOrigin=${JSON.stringify(runtimeOrigin)};const uiOrigin=${JSON.stringify(location.origin)};\n${workerSource}`;
    return new Promise(resolve => {
        const start = performance.now();
        const frame = document.createElement('iframe');
        frame.hidden = true;
        frame.sandbox = 'allow-scripts';
        frame.referrerPolicy = 'no-referrer';
        const nonce = crypto.randomUUID().replaceAll('-', '');
        const channel = crypto.randomUUID();
        let finished = false, deadline, readyAt;
        const observed = [];
        let observedBytes = 0;
        const terminal = reason => ({meta: {language: 'python', truncated: true, stopReason: reason}, steps: observed, stdout: observed.at(-1)?.stdout || '', error: null});
        const finish = result => {
            if (finished) return;
            result = normalizeResult(result) || {meta:{language:'python',truncated:true,stopReason:'invalid_result'},steps:[],stdout:'',error:null};
            finished = true;
            clearTimeout(deadline);
            clearTimeout(watchdog);
            window.removeEventListener('message', receive);
            signal?.removeEventListener('abort', cancel);
            frame.remove();
            result.meta.elapsedMs = Math.round(performance.now() - start);
            result.meta.startupMs = readyAt ? Math.round(readyAt - start) : null;
            result.meta.executionMs = readyAt ? Math.round(performance.now() - readyAt) : null;
            resolve(result);
        };
        const cancel = () => finish(terminal('cancelled'));
        const watchdog = setTimeout(() => finish(terminal('startup_timeout')), 45000);
        const receive = event => {
            if (event.source !== frame.contentWindow || event.data?.channel !== channel) return;
            if (event.data.type === 'ready') {
                if (readyAt) return;
                readyAt = performance.now();
                clearTimeout(watchdog);
                // Independent of both the busy worker and its iframe controller.
                deadline = setTimeout(() => finish(terminal('timeout')), timeoutMs + 1000);
            } else if (event.data.type === 'progress') {
                const step = event.data.result;
                if(!validStep(step))return finish(terminal('invalid_result'));
                observedBytes += JSON.stringify(step).length;
                if (observed.length >= 500 || observedBytes > 1000000) return finish(terminal('trace_size_limit'));
                observed.push(step);
            } else if (event.data.type === 'result') {
                const result = event.data.result;
                if (!normalizeResult(result)) return finish(terminal('invalid_result'));
                finish(result);
            } else if (event.data.type === 'timeout' || event.data.type === 'failed') {
                const result = terminal(event.data.type === 'timeout' ? 'timeout' : 'runner_error');
                if (event.data.type === 'failed') result.error = {
                    type: 'RunnerStartupError', stage: String(event.data.result?.stage || 'worker_load').slice(0,80),
                    message: String(event.data.result?.message || 'The browser could not start the isolated worker.').slice(0,400)
                };
                finish(result);
            }
        };
        window.addEventListener('message', receive);
        signal?.addEventListener('abort', cancel, {once: true});
        // Only trusted controller code enters HTML; user code travels by message.
        // Pyodide's Emscripten bridge needs eval. It remains inside the opaque runner,
        // with no app-origin access and connections restricted to the static host.
        frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' blob: ${runtimeOrigin} 'unsafe-eval' 'wasm-unsafe-eval'; worker-src blob:; connect-src ${runtimeOrigin}; base-uri 'none'; form-action 'none'"><script nonce="${nonce}">
        const channel = ${JSON.stringify(channel)};
        const relay = (type, result) => parent.postMessage({channel, type, result}, '*');
        let worker, timer;
        addEventListener('message', event => {
            if (event.source !== parent || event.data?.channel !== channel || worker) return;
            const data = event.data;
            try {
                // A classic bootstrap can start from blob:null in the opaque frame.
                // The bootstrap dynamically imports the ES-module Pyodide runtime.
                worker = new Worker(URL.createObjectURL(new Blob([data.workerSource], {type:'text/javascript'})));
            } catch (error) {
                relay('failed', {stage:'worker_create', message:String(error.message).slice(0,400)}); return;
            }
            worker.onerror = event => {clearTimeout(timer); worker.terminate(); relay('failed', {stage:'worker_load', message:event.message || 'Worker module loading failed'});};
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
        }, {once:true});
        relay('loaded');
        <\/script>`;
        frame.onload = () => frame.contentWindow.postMessage({channel, workerSource:bootstrap, recorder, code, inputs, timeoutMs}, '*');
        document.body.append(frame);
        if (signal?.aborted) cancel();
    });
}
