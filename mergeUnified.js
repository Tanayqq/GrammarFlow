const fs = require('fs');

const textHtml = fs.readFileSync('stitch_generated.html', 'utf8');
const docHtml = fs.readFileSync('stitch_doc_ai.html', 'utf8');

// Extract the Text Area from textHtml
const textAreaMatch = textHtml.match(/<!-- BEGIN: Text Area -->([\s\S]*?)<!-- END: Text Area -->/);
const textAreaHtml = textAreaMatch ? textAreaMatch[1] : '';

// Extract the Controls Footer (Tone chips + buttons) from textHtml
const controlsMatch = textHtml.match(/<!-- BEGIN: Controls Footer -->([\s\S]*?)<!-- END: Controls Footer -->/);
const controlsHtml = controlsMatch ? controlsMatch[1] : '';

// Split the Controls Footer into Tone chips and Action Buttons
// Action Buttons:
const actionBtnsMatch = controlsHtml.match(/<!-- Action Buttons -->([\s\S]*?)<\/div>\s*<\/div>/);
let actionBtnsHtml = actionBtnsMatch ? actionBtnsMatch[1] : '';
actionBtnsHtml = actionBtnsHtml.replace('Fix Grammar', '<button id="fixGrammarBtn" style="display:none;"></button>Fix Grammar'); // Wait, better just add IDs.
actionBtnsHtml = actionBtnsHtml.replace('<button class="flex-1', '<button id="fixGrammarBtn" class="flex-1');
actionBtnsHtml = actionBtnsHtml.replace('<button class="flex-1', '<button id="rewriteBtn" class="flex-1'); // Wait, first one is fix, second is rewrite.

let finalActionBtnsHtml = `
<div class="flex flex-1 md:flex-none gap-3" id="textActionButtons">
    <button id="fixGrammarBtn" class="flex-1 md:flex-none px-10 py-4 rounded-2xl font-semibold text-gray-300 bg-[#252545] border border-white/5 hover:bg-[#2d2d55] transition-all">Fix Grammar</button>
    <button id="rewriteBtn" class="flex-1 md:flex-none px-10 py-4 rounded-2xl font-bold text-white bg-gradient-to-r from-purple-500 to-blue-500 shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:shadow-[0_0_30px_rgba(168,85,247,0.6)]">Rewrite Paragraph</button>
</div>
`;

// Extract Tone Chips (global controls)
let globalControlsHtml = `
<div class="flex flex-wrap items-center gap-6" id="globalControls">
    <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-gray-400">Tone:</span>
        <div class="flex gap-2">
            <button type="button" onclick="document.getElementById('toneSelect').value='Casual';" class="px-5 py-2 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/50 shadow-[0_0_10px_rgba(168,85,247,0.2)]">Casual</button>
            <button type="button" onclick="document.getElementById('toneSelect').value='Friendly';" class="px-5 py-2 rounded-full text-xs font-semibold bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 transition-colors">Friendly</button>
            <button type="button" onclick="document.getElementById('languageSelect').value='Auto';" class="px-5 py-2 rounded-full text-xs font-semibold bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 transition-colors">Auto-Detect</button>
        </div>
    </div>
    <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-gray-400">Human Mode</span>
        <label class="relative inline-flex items-center cursor-pointer">
            <input id="humanizeToggle" type="checkbox" class="sr-only peer" checked>
            <div class="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
        </label>
    </div>
</div>
`;


// Extract Document AI chunks from docHtml
const docUploadMatch = docHtml.match(/<!-- BEGIN: Document Upload Area -->([\s\S]*?)<!-- END: Document Upload Area -->/);
let docUploadHtml = docUploadMatch ? docUploadMatch[1] : '';
docUploadHtml = docUploadHtml.replace('id="drop-zone"', 'id="documentUploadZone"');

const docInputMatch = docHtml.match(/<!-- BEGIN: Summarization Input -->([\s\S]*?)<!-- END: Summarization Input -->/);
const docInputHtml = docInputMatch ? docInputMatch[1] : '';

const docActionMatch = docHtml.match(/<!-- BEGIN: Primary Action -->([\s\S]*?)<!-- END: Primary Action -->/);
let docActionHtml = docActionMatch ? docActionMatch[1] : '';
docActionHtml = docActionHtml.replace('id="process-button"', 'id="processDocumentBtn"');

// Construct the full HTML body
const newBodyContent = `
<div class="cosmic-bg"></div>
<div class="nebula-glow" style="top: -100px; right: -100px;"></div>
<div class="nebula-glow" style="bottom: -150px; left: -100px; background: radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%);"></div>

<main class="w-full max-w-5xl" data-purpose="editor-main-container">
    <div class="glass-panel rounded-3xl overflow-hidden p-6 md:p-8 flex flex-col gap-6 relative">
        
        <!-- Tabs Navigation -->
        <nav class="flex justify-center items-center mb-2" data-purpose="editor-tabs">
            <div class="bg-[#1a1a2e] rounded-xl p-1.5 flex gap-2 border border-white/5">
                <button id="tabText" class="px-8 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 bg-[#252545] text-white glow-border-purple shadow-lg">Text Editor</button>
                <button id="tabDocument" class="px-8 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 text-gray-400 hover:text-white hover:bg-white/5">Document AI</button>
            </div>
        </nav>

        <!-- TEXT MODE CONTAINER -->
        <div id="textModeContainer">
            <div class="relative group" data-purpose="editor-canvas">
                <textarea class="w-full h-80 md:h-96 bg-black/20 rounded-2xl p-6 text-lg text-white/90 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500/50 border border-white/5 resize-none custom-scrollbar transition-all" id="inputText" placeholder="Start typing naturally..."></textarea>
            </div>
        </div>

        <!-- DOCUMENT AI MODE CONTAINER -->
        <div id="documentModeContainer" class="hidden">
            ${docUploadHtml}
            ${docInputHtml}
        </div>

        <!-- SHARED FOOTER CONTROLS -->
        <div class="flex flex-wrap items-center justify-between gap-6 pt-2" data-purpose="editor-controls">
            ${globalControlsHtml}
            
            <!-- Text Actions -->
            <div id="textActionContainer">
                ${finalActionBtnsHtml}
            </div>

            <!-- Document Actions -->
            <div id="documentActionContainer" class="hidden">
                ${docActionHtml}
            </div>
        </div>

        <!-- HIDDEN APP.JS BINDINGS -->
        <div class="hidden" style="display:none;">
            <select id="toneSelect"><option value="Casual">Casual</option><option value="Friendly">Friendly</option></select>
            <select id="styleSelect"><option value="Casual">Casual</option></select>
            <select id="languageSelect"><option value="Auto">Auto-Detect</option></select>
            <input type="file" id="fileInput" accept="image/*,application/pdf" multiple>
            <select id="documentModeSelect"><option value="Summarize">Summarize</option></select>
            
            <div id="highlighterOverlay"></div>
            <div id="appLogo"></div>
            <div id="filePreviewContainer"></div>
            <button id="processDocBtn"></button>
            <button id="cancelProcessBtn"></button>
            
            <div id="loadingIndicator"></div>
            <div id="suggestionCounter"></div>
            <button id="prevSuggestionBtn"></button>
            <button id="nextSuggestionBtn"></button>
            <div id="resumePrompt"></div>
            <button id="resumeYesBtn"></button>
            <button id="resumeNoBtn"></button>
            <div id="exportControls"></div>
            <button id="downloadPdfBtn"></button>
            <button id="downloadDocxBtn"></button>
            
            <div id="outputSection"><div id="resultsList"></div></div>
            <div id="assistantBar"><div id="suggestionText"></div><div id="suggestionLabel"></div><button id="applySuggestionBtn"></button></div>
        </div>

    </div>
</main>
<script src="app.js?v=4.7"></script>
<script>
    // Tab Switching Logic for Tailwind UI
    document.getElementById('tabText').addEventListener('click', function() {
        this.classList.add('bg-[#252545]', 'text-white', 'glow-border-purple', 'shadow-lg');
        this.classList.remove('text-gray-400');
        
        const docTab = document.getElementById('tabDocument');
        docTab.classList.remove('bg-[#252545]', 'text-white', 'glow-border-purple', 'shadow-lg');
        docTab.classList.add('text-gray-400');
        
        document.getElementById('textModeContainer').classList.remove('hidden');
        document.getElementById('textActionContainer').classList.remove('hidden');
        document.getElementById('documentModeContainer').classList.add('hidden');
        document.getElementById('documentActionContainer').classList.add('hidden');
    });

    document.getElementById('tabDocument').addEventListener('click', function() {
        this.classList.add('bg-[#252545]', 'text-white', 'glow-border-purple', 'shadow-lg');
        this.classList.remove('text-gray-400');
        
        const txtTab = document.getElementById('tabText');
        txtTab.classList.remove('bg-[#252545]', 'text-white', 'glow-border-purple', 'shadow-lg');
        txtTab.classList.add('text-gray-400');
        
        document.getElementById('documentModeContainer').classList.remove('hidden');
        document.getElementById('documentActionContainer').classList.remove('hidden');
        document.getElementById('textModeContainer').classList.add('hidden');
        document.getElementById('textActionContainer').classList.add('hidden');
    });
</script>
`;

let finalHtml = textHtml.replace(/<body[^>]*>([\s\S]*?)<\/body>/, '<body class="flex items-center justify-center min-h-screen p-4 md:p-8">\n' + newBodyContent + '\n</body>');

fs.writeFileSync('public/index.html', finalHtml);
console.log('Successfully generated unified index.html with Doc AI');
