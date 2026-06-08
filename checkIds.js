const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');

const requiredIds = [
    "inputText", "highlighterOverlay", "styleSelect", "toneSelect", 
    "languageSelect", "humanizeToggle", "rewriteBtn", "fixGrammarBtn",
    "outputSection", "loadingIndicator", "resultsList", "assistantBar",
    "suggestionText", "suggestionLabel", "suggestionCounter", "applySuggestionBtn",
    "prevSuggestionBtn", "nextSuggestionBtn", "appLogo", "tabText",
    "tabDocument", "textModeContainer", "documentModeContainer", "textActionButtons",
    "globalControls", "documentUploadZone", "fileInput", "filePreviewContainer",
    "documentModeSelect", "processDocumentBtn"
];

let missing = [];
requiredIds.forEach(id => {
    // simple check
    if (!html.includes(`id="${id}"`) && !html.includes(`id='${id}'`)) {
        missing.push(id);
    }
});

console.log("Missing IDs:", missing.length > 0 ? missing : "None! All IDs are present.");
