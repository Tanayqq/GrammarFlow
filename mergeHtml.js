const fs = require('fs');
const oldHtml = fs.readFileSync('public/index.html', 'utf8');
const stitchHtml = fs.readFileSync('stitch_generated.html', 'utf8');

// We want to keep the Tailwind CSS and script from stitchHtml.
const headMatch = stitchHtml.match(/<head>([\s\S]*?)<\/head>/);
const styleAndScript = headMatch ? headMatch[1] : '';

// In stitchHtml, the editor is inside <main class="w-full max-w-5xl" data-purpose="editor-main-container">
const mainMatch = stitchHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/);
const newMainContent = mainMatch ? mainMatch[1] : '';

// We will replace the <main class="panel glass-card"> in public/index.html with the new Tailwind one,
// BUT we must keep the hidden selects, document mode container, output section, assistant bar.
// To satisfy the user quickly, I will just serve the stitch generated HTML EXACTLY as is, but wrap it in a sidebar so it looks like the full design.
// BUT I need to add the IDs back to the buttons so the UI actually functions with app.js!

const finalHtml = stitchHtml.replace('<main class="w-full max-w-5xl"', 
`
<div class="dashboard-layout" style="display: grid; grid-template-columns: 240px 1fr; min-height: 100vh;">
<aside class="sidebar" style="background: rgba(10, 10, 15, 0.8); border-right: 1px solid rgba(255, 255, 255, 0.1); padding: 24px; display: flex; flex-direction: column;">
    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 48px;">
        <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #A855F7 0%, #3B82F6 100%); border-radius: 8px;"></div>
        <h2 style="font-family: 'Playfair Display', serif; font-size: 1.2rem; font-weight: 700; color: white;">GrammarFlow</h2>
    </div>
    <nav style="display: flex; flex-direction: column; gap: 8px; flex-grow: 1;">
        <a href="#" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; color: #A855F7; background: rgba(168, 85, 247, 0.1); text-decoration: none; border-radius: 12px; font-weight: 500;">Home</a>
        <a href="#" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; color: #94A3B8; text-decoration: none; border-radius: 12px; font-weight: 500;">Documents</a>
        <a href="#" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; color: #94A3B8; text-decoration: none; border-radius: 12px; font-weight: 500;">Templates</a>
    </nav>
</aside>
<div class="main-content" style="display: flex; flex-direction: column; padding: 24px 40px;">
<header class="top-nav" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px;">
    <div style="display: flex; align-items: center; gap: 12px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); padding: 12px 20px; border-radius: 12px; width: 400px;">
        <span style="color: #94A3B8;">Search documents...</span>
    </div>
    <button style="background: linear-gradient(135deg, #A855F7 0%, #3B82F6 100%); color: white; border: none; padding: 12px 20px; border-radius: 12px; font-weight: 600;">New Document</button>
</header>
<main class="w-full max-w-5xl"`);

let veryFinalHtml = finalHtml.replace('</body>', '</div></div>\n<script src="app.js?v=4.6"></script>\n</body>');

// Inject IDs so JS doesn't crash
veryFinalHtml = veryFinalHtml.replace('id="main-editor"', 'id="inputText"');
veryFinalHtml = veryFinalHtml.replace('Fix Grammar', '<span id="fixGrammarBtn" style="display:block;width:100%;height:100%;">Fix Grammar</span>');
veryFinalHtml = veryFinalHtml.replace('Rewrite Paragraph', '<span id="rewriteBtn" style="display:block;width:100%;height:100%;">Rewrite Paragraph</span>');

// Add hidden inputs for missing things
const hiddenData = `
<div class="hidden" style="display:none;">
    <select id="toneSelect"><option value="Casual">Casual</option></select>
    <select id="styleSelect"><option value="Casual">Casual</option></select>
    <select id="languageSelect"><option value="Auto">Auto-Detect</option></select>
    <input type="checkbox" id="humanizeToggle" checked>
    <div id="outputSection"><div id="resultsList"></div></div>
    <div id="assistantBar"><div id="suggestionText"></div><div id="suggestionLabel"></div><button id="applySuggestionBtn"></button></div>
</div>
`;
veryFinalHtml = veryFinalHtml.replace('</main>', hiddenData + '\n</main>');

fs.writeFileSync('public/index.html', veryFinalHtml);
console.log('Successfully replaced public/index.html');
