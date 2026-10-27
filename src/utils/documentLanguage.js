// A conservative language check, not a semantic accuracy guarantee.
function isRomanHinglish(text) {
    const prose = text.replace(/```[\s\S]*?```/g, '').split('\n')
        .filter(line => !/^\s*[|>#]/.test(line)).join('\n');
    if (/[\u0900-\u097f]/.test(prose)) return false;
    const markers = /\b(hai|hain|tha|thi|mein|ka|ki|ke|ko|se|aur|ya|yeh|ye|woh|vo|ek|bhi|nahi|nahin|liye|hota|hoti|hote|karta|karti|karte|matlab|samjho|agar|lekin|jab|isliye|hum|aap|tum|isse|uska|iska)\b/gi;
    const words = prose.match(/\b[a-z]+\b/gi) || [];
    if (words.length < 5) return false;
    if ((prose.match(markers) || []).length < Math.max(2, Math.floor(words.length / 30))) return false;
    return prose.split(/\n\s*\n/).every(paragraph =>
        (paragraph.match(/\b[a-z]+\b/gi) || []).length < 40 || (paragraph.match(markers) || []).length >= 2);
}
module.exports = { isRomanHinglish };
