const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

// 1. We need to extract outputSection and loadingIndicator from the hidden div
html = html.replace('<div id="loadingIndicator"></div>', '');
html = html.replace('<div id="outputSection"><div id="resultsList"></div></div>', '');

// 2. We need to create a beautifully styled output section that fits the cosmic theme
const styledOutputSection = `
<!-- BEGIN: Output & Loading Section -->
<div id="loadingIndicator" class="hidden mt-6 flex flex-col items-center justify-center p-8">
    <div class="w-10 h-10 border-4 border-nebula-purple/30 border-t-nebula-purple rounded-full animate-spin shadow-[0_0_15px_rgba(168,85,247,0.5)]"></div>
    <span class="mt-4 text-purple-400 font-medium tracking-wider text-sm">ANALYZING...</span>
</div>

<div id="outputSection" class="hidden mt-6">
    <div class="bg-black/30 border border-white/10 rounded-2xl p-6 relative group overflow-hidden">
        <div class="absolute inset-0 bg-gradient-to-r from-purple-500/5 to-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
        <div id="resultsList" class="relative z-10 text-white/90 text-lg leading-relaxed flex flex-col gap-4"></div>
    </div>
</div>
<!-- END: Output & Loading Section -->
`;

// Insert the styled output section right before the end of the textModeContainer
html = html.replace('</div>\n\n        <!-- DOCUMENT AI MODE CONTAINER -->', styledOutputSection + '\n        </div>\n\n        <!-- DOCUMENT AI MODE CONTAINER -->');

// 3. We need to add interactivity to the Tone Chips
// I will replace the current hardcoded onclicks with a function call
html = html.replace(/onclick="document\.getElementById\('toneSelect'\)\.value='Casual';"/g, 'onclick="selectTone(\\\'Casual\\\', this)"');
html = html.replace(/onclick="document\.getElementById\('toneSelect'\)\.value='Friendly';"/g, 'onclick="selectTone(\\\'Friendly\\\', this)"');
html = html.replace(/onclick="document\.getElementById\('languageSelect'\)\.value='Auto';"/g, 'onclick="selectTone(\\\'Auto\\\', this)"'); // Reusing tone function for visual swap

// Add the JS function at the bottom
const toneScript = `
<script>
    function selectTone(value, btn) {
        // Find the select element
        if (value === 'Auto') {
            document.getElementById('languageSelect').value = value;
        } else {
            document.getElementById('toneSelect').value = value;
        }

        // Visually update the chips
        const parent = btn.parentElement;
        parent.querySelectorAll('button').forEach(b => {
            b.classList.remove('bg-purple-500/10', 'text-purple-400', 'border-purple-500/50', 'shadow-[0_0_10px_rgba(168,85,247,0.2)]');
            b.classList.add('bg-white/5', 'text-gray-400', 'border-white/10');
            
            // For the stitch_doc_ai style chips
            b.classList.remove('chip-active');
            b.classList.remove('text-white');
        });

        // Add active classes to the clicked button
        btn.classList.remove('bg-white/5', 'text-gray-400', 'border-white/10');
        btn.classList.add('bg-purple-500/10', 'text-purple-400', 'border-purple-500/50', 'shadow-[0_0_10px_rgba(168,85,247,0.2)]');
        
        // Also add stitch_doc_ai style active classes just in case
        btn.classList.add('chip-active');
    }
</script>
`;

html = html.replace('</body>', toneScript + '\n</body>');

fs.writeFileSync('public/index.html', html);
console.log('Fixed Output Section and Interactivity');
