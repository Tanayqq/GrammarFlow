const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

// The new Tailwind styled select HTML
const selectHtml = `
<div class="flex flex-wrap items-center gap-6" id="globalControls">
    <!-- Language Dropdown -->
    <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-gray-400">Language:</span>
        <div class="relative">
            <select id="languageSelect" class="appearance-none bg-[#252545] border border-white/10 rounded-full py-2 pl-4 pr-10 text-sm font-semibold text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500/50 hover:bg-[#2d2d55] transition-all cursor-pointer shadow-[0_0_10px_rgba(168,85,247,0.1)]">
                <option value="English">English</option>
                <option value="Hinglish">Hinglish</option>
                <option value="Hindi">Hindi</option>
                <option value="Telugu">Telugu</option>
                <option value="Kannada">Kannada</option>
                <option value="Auto">Auto-Detect</option>
            </select>
            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
        </div>
    </div>

    <!-- Style Dropdown -->
    <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-gray-400">Style:</span>
        <div class="relative">
            <select id="styleSelect" class="appearance-none bg-[#252545] border border-white/10 rounded-full py-2 pl-4 pr-10 text-sm font-semibold text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500/50 hover:bg-[#2d2d55] transition-all cursor-pointer shadow-[0_0_10px_rgba(168,85,247,0.1)]">
                <option value="Professional">Professional</option>
                <option value="Academic">Academic</option>
                <option value="Casual" selected>Casual</option>
                <option value="Creative">Creative</option>
                <option value="Direct">Direct</option>
            </select>
            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
        </div>
    </div>

    <!-- Tone Dropdown -->
    <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-gray-400">Tone:</span>
        <div class="relative">
            <select id="toneSelect" class="appearance-none bg-[#252545] border border-white/10 rounded-full py-2 pl-4 pr-10 text-sm font-semibold text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500/50 hover:bg-[#2d2d55] transition-all cursor-pointer shadow-[0_0_10px_rgba(168,85,247,0.1)]">
                <option value="Neutral">Neutral</option>
                <option value="Confident">Confident</option>
                <option value="Friendly" selected>Friendly</option>
                <option value="Persuasive">Persuasive</option>
                <option value="Empathetic">Empathetic</option>
            </select>
            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
        </div>
    </div>

    <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-gray-400">Human Mode</span>
`;

// Extract the original globalControls chunk that we want to replace
const startMatch = html.indexOf('<div class="flex flex-wrap items-center gap-6" id="globalControls">');
const endMatch = html.indexOf('<span class="text-sm font-medium text-gray-400">Human Mode</span>');

if (startMatch !== -1 && endMatch !== -1) {
    const chunkToReplace = html.substring(startMatch, endMatch + '<span class="text-sm font-medium text-gray-400">Human Mode</span>'.length);
    html = html.replace(chunkToReplace, selectHtml);
}

// Remove the old hidden selects from the hidden bindings div since we now have real visible ones
html = html.replace(/<select id="toneSelect">.*?<\/select>/s, '');
html = html.replace(/<select id="styleSelect">.*?<\/select>/s, '');
html = html.replace(/<select id="languageSelect">.*?<\/select>/s, '');

// Save the file
fs.writeFileSync('public/index.html', html);
console.log('Fixed Dropdowns Successfully');
