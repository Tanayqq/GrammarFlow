function isExpectedLanguage(text, language) {
    if (!text || !language) return true;
    
    const lang = language.toLowerCase();
    
    // Hinglish (Mixed) allows everything
    if (lang.includes("hinglish")) return true;

    // Strict English Validation (Reject Hinglish Leakage)
    if (lang.includes("english")) {
        const forbiddenHinglishWords = ["arre", "bhai", "yaar", "acha", "kya", "toh", "kaise", "ji", "beta", "nahin", "theek"];
        const words = text.toLowerCase().split(/\W+/);
        const hasLeakage = words.some(word => forbiddenHinglishWords.includes(word));
        if (hasLeakage) {
            console.warn(`[VALIDATOR] Hinglish leakage detected in English mode: "${text.substring(0, 50)}..."`);
            return false;
        }
        return true;
    }

    const scriptRanges = {
        hindi: /[\u0900-\u097F]/,
        telugu: /[\u0C00-\u0C7F]/,
        kannada: /[\u0CB0-\u0CFF]/
    };

    const range = scriptRanges[lang.replace("(strict)", "").trim()];
    if (!range) return true; // Unknown language, skip check

    const matches = text.match(new RegExp(range, 'g')) || [];
    if (matches.length === 0) return false;

    const ratio = matches.length / text.replace(/\s/g, '').length;
    return ratio > 0.3;
}

module.exports = { isExpectedLanguage };
