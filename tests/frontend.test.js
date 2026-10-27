const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const read = file => readFileSync(path.join(__dirname, '..', file), 'utf8');
async function editor(t, respond = () => ({ success: true, data: ['Corrected text.'] }), draft, clerkUser) {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM(read('public/index.html'), {
        url: 'https://grammarflow.example/', runScripts: 'outside-only',
        pretendToBeVisual: true, virtualConsole: vc
    });
    t.after(() => dom.window.close());
    const w = dom.window;
    Object.defineProperty(w.crypto, 'subtle', { value: require('node:crypto').webcrypto.subtle });
    w.TextEncoder = TextEncoder;
    await new Promise(resolve => setImmediate(resolve));
    w.alert = () => {};
    w.confirm = () => false;
    w.tailwind = {};
    w.fetch = async (url, options) => ({ ok: true, json: async () =>
        url.endsWith('/auth/config') ? { success: true, data: clerkUser ? { clerkPublishableKey: 'synthetic-key' } : {} } : respond(url, options) });
    if (clerkUser) {
        w.Clerk = { user: clerkUser, session: { getToken: async () => 'synthetic-token' },
            load: async () => {}, addListener: listener => { w.clerkListener = listener; } };
        const append = w.document.body.appendChild.bind(w.document.body);
        w.document.body.appendChild = element => {
            const result = append(element);
            if (element.tagName === 'SCRIPT' && element.src.includes('clerk')) queueMicrotask(() => element.onload());
            return result;
        };
    }
    if (draft !== undefined) w.localStorage.setItem('gf_editor_draft', draft);
    w.eval(read('public/vendor/purify.min.js'));
    const { marked } = await import('marked');
    w.marked = marked;
    w.eval(read('public/app-v16.js'));
    // Execute inline scripts too: duplicate tab handlers previously referenced missing elements.
    for (const script of w.document.querySelectorAll('script:not([src])')) w.eval(script.textContent);
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    await new Promise(resolve => setImmediate(resolve));
    return { w, errors, get: id => w.document.getElementById(id) };
}

test('editorial navigation keeps draft and restores controls after document extraction', async t => {
    const app = await editor(t, undefined, 'Keep my draft.');
    app.get('exploreDocumentBtn').click();
    assert.equal(app.get('tabDocument').getAttribute('aria-selected'), 'true');
    assert.equal(app.get('documentActionContainer').classList.contains('hidden'), false);
    app.get('documentModeSelect').value = 'Grammar';
    app.w.documentProcessor.updateOCRMode();
    assert.equal(app.get('globalControls').style.display, 'none');
    app.get('tabDocument').dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(app.get('tabText').getAttribute('aria-selected'), 'true');
    assert.equal(app.get('globalControls').style.display, '');
    assert.equal(app.get('inputText').value, 'Keep my draft.');
    assert.equal(app.get('textActionContainer').classList.contains('hidden'), false);
    const ids = [...app.w.document.querySelectorAll('[id]')].map(n => n.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(app.errors.length, 0);
});

test('focus mode carries edits back to the draft on Escape and reopens them', async t => {
    const app = await editor(t, undefined, 'My original draft.');
    app.get('expandFlowBtn').click();
    await new Promise(resolve => app.w.requestAnimationFrame(resolve));
    assert.equal(app.get('flowOverlay').classList.contains('hidden'), false);
    const paragraph = app.get('fovCameraTrack').querySelector('textarea');
    assert.equal(paragraph.value, 'My original draft.');
    paragraph.value = 'My refined draft.';
    paragraph.dispatchEvent(new app.w.Event('input', { bubbles: true }));
    paragraph.dispatchEvent(new app.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(app.get('inputText').value, 'My refined draft.');
    assert.equal(app.w.localStorage.getItem('gf_editor_draft'), 'My refined draft.');
    await new Promise(resolve => setTimeout(resolve, 370));
    assert.equal(app.get('flowOverlay').classList.contains('hidden'), true);
    app.get('expandFlowBtn').click();
    assert.equal(app.get('fovCameraTrack').querySelector('textarea').value, 'My refined draft.');
});

test('AI output is displayed without executable HTML; detailed analysis stays safe', async t => {
    const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>[unsafe](javascript:alert%281%29)';
    const app = await editor(t, () => ({ success: true, data: [payload] }));
    app.get('inputText').value = 'A synthetic sentence.';
    await app.get('fixGrammarBtn').onclick();
    assert.equal(app.get('resultsList').querySelector('[onerror], script, [href^="javascript:"]'), null);
    assert.equal(app.get('fixGrammarBtn').disabled, false);
    const detailed = await editor(t, () => ({ success: true, data: [`${payload}===GF_SEPARATOR===${payload}`] }));
    detailed.get('inputText').value = 'A synthetic sentence.';
    await detailed.get('fixGrammarBtn').onclick();
    assert.equal(detailed.get('resultsList').querySelector('[onerror], script, [href^="javascript:"]'), null);
});

test('document processing recovers from a corrupt resume cache', async t => {
    const app = await editor(t);
    const processor = app.w.documentProcessor;
    processor.switchTab('document');
    const file = new app.w.File(['x'], 'sample.pdf', { type: 'application/pdf' });
    processor.handleFiles([file]);
    // Stub only the external PDF extraction engine; execute the real document pipeline.
    processor.extractPdfText = async () => 'She goes to school every day.';
    const mode = app.get('documentModeSelect').value;
    app.w.localStorage.setItem(processor.getCacheKey(file, mode, app.get('languageSelect').value), '{broken');
    await processor.processDocument();
    assert.equal(app.get('docLoadingIndicator').classList.contains('hidden'), true);
    assert.equal(app.get('fixGrammarBtn').disabled, false);
    assert.match(app.get('docResultsList').textContent, /Corrected text/);
});

test('document chunks preserve multilingual text without omission or duplication', async t => {
    const app = await editor(t);
    for (const language of ['English', 'Hindi', 'Hinglish', 'Kannada', 'Telugu']) {
        const text = 'A paragraph. नमस्ते. ನಮಸ್ಕಾರ. నమస్కారం.\n\n'.repeat(300);
        const chunks = app.w.documentProcessor.chunkText(text, language);
        assert.equal(chunks.join(''), text, language);
        assert.ok(chunks.length > 1);
    }
});

test('uploaded filenames are text and unsupported files are not queued', async t => {
    const app = await editor(t);
    const files = [new app.w.File(['x'], '<img src=x onerror=alert(1)>.pdf', { type: 'application/pdf' }),
        new app.w.File(['x'], 'program.exe', { type: 'application/octet-stream' })];
    app.w.documentProcessor.handleFiles(files);
    assert.equal(app.w.documentProcessor.files.length, 1);
    assert.equal(app.get('filePreviewContainer').querySelector('img'), null);
    assert.ok(app.get('filePreviewContainer').textContent.includes(files[0].name));
    app.w.documentProcessor.removeFile(0);
    assert.equal(app.get('processDocumentBtn').disabled, true);
});

test('switching document/text tabs does not throw and preserves supported languages', async t => {
    const app = await editor(t);
    app.get('tabDocument').click();
    assert.equal(app.get('documentModeContainer').classList.contains('hidden'), false);
    app.get('tabText').click();
    assert.equal(app.get('textModeContainer').classList.contains('hidden'), false);
    assert.ok([...app.get('languageSelect').options].some(option => option.value === 'Kannada'));
    assert.equal(app.errors.length, 0, app.errors.map(e => e.message).join('\n'));
});

test('network failures release controls and retain the input', async t => {
    const app = await editor(t, () => { throw new Error('Synthetic network failure'); });
    app.get('inputText').value = 'Keep this draft.';
    await app.get('fixGrammarBtn').onclick();
    assert.equal(app.get('inputText').value, 'Keep this draft.');
    assert.equal(app.get('fixGrammarBtn').disabled, false);
    assert.equal(app.get('loadingIndicator').classList.contains('hidden'), true);
    assert.match(app.get('resultsList').textContent, /temporarily unavailable/);
    assert.doesNotMatch(app.get('resultsList').textContent, /Synthetic network failure/);
});

test('document throttling stops after a long retry delay and keeps the source available', async t => {
    const app = await editor(t);
    let calls = 0;
    app.w.fetch = async () => {
        calls++;
        return { ok: false, status: 503, json: async () => ({ success: false, retryAfter: 90,
            error: { message: 'Writing assistance is temporarily busy. Your text has not been changed.' } }) };
    };
    const processor = app.w.documentProcessor;
    processor.switchTab('document');
    processor.handleFiles([new app.w.File(['sample'], 'sample.pdf', { type: 'application/pdf' })]);
    processor.extractPdfText = async () => 'A synthetic source paragraph.';
    await processor.processDocument();
    assert.equal(calls, 1);
    assert.equal(processor.files.length, 1);
    assert.equal(app.get('docLoadingIndicator').classList.contains('hidden'), true);
    assert.match(app.get('docResultsList').textContent, /temporarily busy/);
});

test('main editor restores and saves drafts, including an explicitly cleared draft', async t => {
    const app = await editor(t, undefined, 'Draft before reload.');
    assert.equal(app.get('inputText').value, 'Draft before reload.');
    app.get('inputText').value = 'Updated draft.';
    app.get('inputText').dispatchEvent(new app.w.Event('input'));
    assert.equal(app.w.localStorage.getItem('gf_editor_draft'), 'Updated draft.');
    app.get('inputText').value = '';
    app.get('inputText').dispatchEvent(new app.w.Event('input'));
    assert.equal(app.w.localStorage.getItem('gf_editor_draft'), '');
});

test('real-time suggestions cannot inject markup and applying one saves the corrected draft', async t => {
    const app = await editor(t, () => ({ success: true, data: [{ original: 'She go', suggestion: 'She goes',
        category: 'grammar" onmouseover="alert(1)', reason: '<img src=x onerror=alert(1)>', confidence: 1 }] }));
    app.get('inputText').value = 'She go to school.';
    app.get('inputText').dispatchEvent(new app.w.Event('input'));
    await new Promise(resolve => setTimeout(resolve, 1700));
    assert.equal(app.get('assistantBar').classList.contains('visible'), true);
    assert.equal(app.get('suggestionText').querySelector('img'), null);
    assert.equal(app.get('highlighterOverlay').querySelector('[onmouseover]'), null);
    app.get('applySuggestionBtn').click();
    assert.equal(app.get('inputText').value, 'She goes to school.');
    assert.equal(app.w.localStorage.getItem('gf_editor_draft'), 'She goes to school.');
});

test('document upload rejects oversized files and bounds the file count', async t => {
    const app = await editor(t);
    const alerts = [];
    app.w.alert = text => alerts.push(text);
    const file = size => ({ type: 'application/pdf', name: 'sample.pdf', size });
    app.w.documentProcessor.handleFiles([file(10 * 1024 * 1024 + 1)]);
    assert.equal(app.w.documentProcessor.files.length, 0);
    app.w.documentProcessor.handleFiles(Array.from({ length: 6 }, () => file(1)));
    assert.equal(app.w.documentProcessor.files.length, 5);
    assert.ok(alerts.some(text => text.includes('10 MB')));
    assert.ok(alerts.some(text => text.includes('five files')));
});

test('sign-out clears drafts and cached writing before another user can restore them', async t => {
    const app = await editor(t, undefined, 'Private synthetic draft.');
    app.w.localStorage.setItem('gf_flow_v2', 'old flow draft');
    app.w.localStorage.setItem('gf_history_detail_old', 'old history');
    app.get('btnSettings').click();
    await new Promise(resolve => setImmediate(resolve));
    app.get('signOutBtn').onclick();
    assert.equal(app.get('inputText').value, '');
    for (const key of ['gf_editor_draft', 'gf_flow_v2', 'gf_history_detail_old']) assert.equal(app.w.localStorage.getItem(key), null);
});

test('document upload is keyboard accessible and processing starts disabled', async t => {
    const app = await editor(t);
    assert.equal(app.get('processDocumentBtn').disabled, true);
    let opens = 0;
    app.get('fileInput').click = () => opens++;
    for (const key of ['Enter', ' ']) app.get('documentUploadZone').dispatchEvent(new app.w.KeyboardEvent('keydown', { key }));
    assert.equal(opens, 2);
    assert.equal(app.get('documentUploadZone').getAttribute('tabindex'), '0');
});

test('PDF extraction disables dynamic code evaluation and preserves page order', async t => {
    const app = await editor(t);
    const data = new ArrayBuffer(4);
    app.w.pdfjsLib = { getDocument: options => {
        assert.equal(options.isEvalSupported, false);
        assert.equal(options.data, data);
        return { promise: Promise.resolve({ numPages: 2, getPage: async page => ({
            getTextContent: async () => ({ items: [{ str: `Page ${page} text.`, hasEOL: true }] })
        }) }) };
    } };
    const text = await app.w.documentProcessor.extractPdfText({ arrayBuffer: async () => data });
    assert.ok(text.indexOf('Page 1 text.') < text.indexOf('Page 2 text.'));
});

test('routine Clerk session updates do not replace an open history detail', async t => {
    const user = { id: 'synthetic-user', fullName: 'Test', primaryEmailAddress: { emailAddress: 'test@example.com' } };
    const app = await editor(t, () => ({ success: true, data: { user } }), undefined, user);
    app.get('historyModal').classList.remove('hidden');
    app.get('historyContent').textContent = 'Current synthetic history detail';
    await app.w.clerkListener({ user, session: app.w.Clerk.session });
    assert.equal(app.get('historyContent').textContent, 'Current synthetic history detail');
});

test('scanned PDF pages use bounded OCR, omit blank pages, and release PDF resources', async t => {
    const app = await editor(t);
    let destroyed = 0, scans = 0;
    app.w.HTMLCanvasElement.prototype.getContext = () => ({});
    app.w.pdfjsLib = { getDocument: () => ({ destroy: async () => destroyed++, promise: Promise.resolve({
        numPages: 3, getPage: async number => ({
            getTextContent: async () => ({ items: number === 1 ? [{ str: 'Digital page.' }] : [] }),
            getViewport: ({ scale }) => ({ width: 4000 * scale, height: 6000 * scale }),
            render: ({ viewport }) => { assert.ok(viewport.width * viewport.height <= 4000001); return { promise: Promise.resolve() }; },
            cleanup: () => {}
        })
    }) }) };
    app.w.documentProcessor.extractImageText = async () => ++scans === 1 ? 'Scanned page.' : '';
    const text = await app.w.documentProcessor.extractPdfText({ arrayBuffer: async () => new ArrayBuffer(1) });
    assert.match(text, /Page 1 ---\nDigital page\.[\s\S]*Page 2 ---\nScanned page\./);
    assert.doesNotMatch(text, /Page 3/); assert.equal(destroyed, 1); assert.equal(scans, 2);
});

test('blank scans never reach AI and controls recover', async t => {
    const app = await editor(t), p = app.w.documentProcessor;
    p.switchTab('document'); app.get('documentModeSelect').value = 'Grammar';
    p.files = [{ name: 'blank.png', type: 'image/png', size: 10 }];
    p.extractImageText = async () => '  ';
    let requests = 0; p.requestWithRetry = async () => { requests++; };
    await p.processDocument();
    assert.equal(requests, 0); assert.match(app.get('docResultsList').textContent, /no readable text found/);
    assert.equal(app.get('processDocumentBtn').disabled, false);
});

test('OCR uses selected language and passes recognized text to grammar correction', async t => {
    const app = await editor(t), p = app.w.documentProcessor;
    p.switchTab('document'); app.get('documentModeSelect').value = 'Grammar';
    app.get('ocrLanguageSelect').value = 'eng+hin';
    p.files = [{ name: 'scan.png', type: 'image/png', size: 10 }];
    let terminated = 0;
    app.w.Tesseract = { createWorker: async language => {
        assert.equal(language, 'eng+hin');
        return { recognize: async () => ({ data: { text: 'She go to school.' } }), terminate: async () => terminated++ };
    } };
    p.requestWithRetry = async (text, mode, language, consolidate, humanize) => {
        assert.equal(text, 'She go to school.'); assert.equal(mode, 'Grammar'); assert.equal(language, 'Auto'); assert.equal(humanize, false);
        return 'She goes to school.';
    };
    await p.processDocument();
    assert.equal(p.finalOutput, 'She goes to school.'); assert.equal(terminated, 1);
    assert.equal(app.get('exportControls').classList.contains('hidden'), false);
});

test('cancel during OCR releases controls, terminates worker, and skips AI', async t => {
    const app = await editor(t), p = app.w.documentProcessor;
    p.switchTab('document'); app.get('documentModeSelect').value = 'Grammar';
    p.files = [{ name: 'scan.png', type: 'image/png', size: 10 }];
    let terminated = 0, ready;
    const started = new Promise(resolve => ready = resolve);
    app.w.Tesseract = { createWorker: async () => ({
        recognize: () => { ready(); return new Promise(() => {}); }, terminate: async () => terminated++
    }) };
    let requests = 0; p.requestWithRetry = async () => { requests++; };
    const processing = p.processDocument();
    await started; app.get('docCancelProcessBtn').click(); await processing;
    assert.equal(requests, 0); assert.equal(terminated, 1);
    assert.match(app.get('docResultsList').textContent, /Canceled/);
    assert.equal(app.get('processDocumentBtn').disabled, false);
});

test('PDF page limits and password failures release the PDF reader', async t => {
    const app = await editor(t); let destroyed = 0;
    app.w.pdfjsLib = { getDocument: () => ({ destroy: async () => destroyed++, promise: Promise.resolve({ numPages: 31 }) }) };
    const file = { arrayBuffer: async () => new ArrayBuffer(1) };
    await assert.rejects(app.w.documentProcessor.extractPdfText(file), /30 pages/);
    app.w.pdfjsLib.getDocument = () => ({ destroy: async () => destroyed++, promise: Promise.reject(Object.assign(new Error(), { name: 'PasswordException' })) });
    await assert.rejects(app.w.documentProcessor.extractPdfText(file), /password protected/);
    assert.equal(destroyed, 2);
});

test('long explanations label partial output, resume only identical source and settings, and never export incomplete work', async t => {
    const app = await editor(t), p = app.w.documentProcessor;
    p.switchTab('document'); app.get('documentModeSelect').value = 'Explain'; app.get('languageSelect').value = 'Hinglish';
    p.files = [{ name: 'benchmark.pdf', size: 10, type: 'application/pdf' }];
    p.extractPdfText = async () => 'Source part one. Source part two.';
    p.chunkText = () => ['one', 'two'];
    // Avoid pacing delays in the simulated provider test.
    app.w.setTimeout = callback => setTimeout(callback, 0);
    let calls = 0;
    p.requestWithRetry = async () => { if (++calls === 2) throw new Error('Service busy.'); return 'Pehla hissa yahan samjhaya gaya hai.'; };
    await p.processDocument();
    assert.match(app.get('docResultsList').textContent, /INCOMPLETE: 1 of 2/);
    assert.equal(app.get('exportControls').classList.contains('hidden'), true);
    assert.equal(p.finalOutput, '');
    let resumes = 0;
    p.promptResume = async () => { resumes++; return true; };
    p.requestWithRetry = async text => { assert.equal(text, 'two'); return 'Doosra hissa ab samjhaya gaya hai.'; };
    await p.processDocument();
    assert.equal(resumes, 1); assert.match(p.finalOutput, /Pehla[\s\S]*Doosra/);
    assert.equal(app.get('exportControls').classList.contains('hidden'), false);
    // Same filename and size, different source: do not reuse the prior partial result.
    app.get('exportControls').classList.add('hidden');
    p.extractPdfText = async () => 'A completely different source.';
    p.chunkText = () => ['different'];
    p.requestWithRetry = async text => { assert.equal(text, 'different'); return 'Naya source alag hai.'; };
    await p.processDocument();
    assert.equal(resumes, 1); assert.equal(p.finalOutput, 'Naya source alag hai.');
});
