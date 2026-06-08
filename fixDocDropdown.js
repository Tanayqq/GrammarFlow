const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

const replacementHtml = `
<section class="mb-6" data-purpose="input-section">
<div class="flex flex-col md:flex-row gap-4 mb-4">
    <div class="flex items-center gap-3">
        <span class="text-sm font-medium text-gray-400 whitespace-nowrap">Document Mode:</span>
        <div class="relative w-full md:w-auto">
            <select id="documentModeSelect" class="w-full md:w-auto appearance-none bg-[#252545] border border-white/10 rounded-full py-3 pl-5 pr-12 text-sm font-semibold text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500/50 hover:bg-[#2d2d55] transition-all cursor-pointer shadow-[0_0_10px_rgba(168,85,247,0.1)]">
                <option value="Summarize" selected>Summarize Document</option>
                <option value="Grammar">Extract & Fix Grammar (OCR)</option>
            </select>
            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-400">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
        </div>
    </div>
</div>
<div class="relative">
<input class="w-full bg-black/40 border border-white/10 rounded-2xl py-4 px-6 text-white placeholder-gray-500 focus:ring-2 focus:ring-nebula-purple focus:border-transparent outline-none transition-all" placeholder="Summarization (Optional)" type="text"/>
</div>
</section>
`;

// Extract the original input section
const startMatch = html.indexOf('<section class="mb-6" data-purpose="input-section">');
const endMatch = html.indexOf('</section>', startMatch);

if (startMatch !== -1 && endMatch !== -1) {
    const chunkToReplace = html.substring(startMatch, endMatch + '</section>'.length);
    html = html.replace(chunkToReplace, replacementHtml);
}

// Remove the old hidden select
html = html.replace(/<select id="documentModeSelect">.*?<\/select>/s, '');

// Save the file
fs.writeFileSync('public/index.html', html);
console.log('Fixed Document AI Dropdown Successfully');
