const TELUGU_WORDS = [
    // Verbs / states
    "undi", "unte", "ledu", "ledhu", "aina", "aindi", "ayindi", "achindi", "ayyindi",
    "vellipoyanu", "vastundi", "pothundi", "padutundi", "chesthunnanu", "antunnaru",
    "cheyyadam", "cheppali", "chudandi", "matladham", "maatladham", "chestha",
    // Pronouns / connectors
    "naaku", "nenu", "meeru", "memu", "mana", "vaadu", "aame", "vaallaki",
    "ikkade", "akkade", "eppudu", "enduku", "ento", "emito", "naku",
    // Adjectives / adverbs
    "chaala", "konchem", "manchidi", "manchi", "kastam", "kastanga",
    "tarvata", "mundu", "ippudu", "inkaa", "mari", "ayitey",
    // Fillers / casual
    "anna", "akka", "anduke", "ante", "ra", "raa"
];

const KANNADA_WORDS = [
    // Verbs / states
    "baralla", "hogalla", "madalla", "ide", "adhu", "hodha", "bandha", "madidha",
    "aagilla", "aagitta", "maadona", "matnadona", "hogona", "barona",
    "bekittu", "bedalla", "aaguttide", "maaduttide", "maadtini", "barteeni",
    // Pronouns / connectors
    "nanu", "neenu", "avru", "avnu", "avlu", "naavu", "nimma", "namma",
    "alli", "illi", "yelli", "yaavaga", "yaake", "enu", "hege",
    // Adjectives / adverbs
    "swalpa", "tumba", "chennagide", "chennagi", "kashta", "kashtada",
    "ivattu", "mele", "kelage", "munche", "naale",
    // Fillers / casual
    "kano", "kanri", "bega", "idiya", "hange", "ri", "ree"
];

const HINGLISH_WORDS = [
    "hai", "hain", "hoon", "tha", "thi", "kya", "toh",
    "yaar", "bhai", "acha", "accha", "nahi", "nahin",
    "mein", "kar", "hota", "hoti", "hote", "karo", "karna",
    "aur", "lekin", "phir", "abhi", "kal", "aaj",
    "matlab", "bilkul", "zaroor", "theek", "arre", "yeh", "woh"
];

const detectLanguage = (text) => {
    if (!text) return 'English';
    
    // 1. Unicode script detection (highest confidence)
    if (/[\u0900-\u097F]/.test(text)) return 'Hindi';
    if (/[\u0C00-\u0C7F]/.test(text)) return 'Telugu';
    if (/[\u0C80-\u0CFF]/.test(text)) return 'Kannada';

    const words = text.toLowerCase().split(/\W+/).filter(Boolean);
    const count = (list) => words.filter(w => list.includes(w)).length;

    const teluguScore = count(TELUGU_WORDS);
    const kannadaScore = count(KANNADA_WORDS);
    const hinglishScore = count(HINGLISH_WORDS);

    const maxScore = Math.max(teluguScore, kannadaScore, hinglishScore);
    if (maxScore < 1) return 'English';

    if (teluguScore === maxScore && teluguScore >= 1) return 'Telugu-English';
    if (kannadaScore === maxScore && kannadaScore >= 1) return 'Kannada-English';
    if (hinglishScore >= 1) return 'Hinglish';

    return 'English';
};

// Fix Grammar follows the language the draft is written in, not the menu. The menu only breaks ties
// the text cannot settle: romanized Telugu/Kannada, and a short Latin draft when Hinglish is selected.
const SCRIPTS = { Hindi: /[ऀ-ॿ]/g, Telugu: /[ఀ-౿]/g, Kannada: /[ಀ-೿]/g };
const draftLanguage = (text, menu) => {
    const letters = [...String(text || '')].filter(ch => /\p{L}/u.test(ch)); // digits and marks do not count
    if (!letters.length) return menu;
    const [name, count] = Object.entries(SCRIPTS)
        .map(([language, pattern]) => [language, letters.filter(ch => ch.match(pattern)).length])
        .sort((a, b) => b[1] - a[1])[0];
    if (count / letters.length >= 0.3) return name; // mixed with English words is still that language
    const value = String(text);
    const short = value.trim().split(/\s+/).length <= 12;
    if (detectLanguage(value) === 'Hinglish' || (menu === 'Hinglish' && short)) return 'Hinglish';
    return /^(Telugu|Kannada)$/.test(menu) && /-English$/.test(detectLanguage(value)) ? menu : 'English';
};

// The model sometimes drops a stray word from another script (Greek, Cyrillic, Hebrew...) into Telugu/Kannada/Hindi output.
// Remove it, unless the draft had it. Latin (names, English words) and the three Indian scripts used here are kept.
const KEPT_SCRIPTS = String.raw`\p{Script=Latin}\p{Script=Kannada}\p{Script=Telugu}\p{Script=Devanagari}`;
const STRAY_RUN = new RegExp(String.raw`[ 	]*(?![${KEPT_SCRIPTS}])\p{L}(?:(?![${KEPT_SCRIPTS}])[\p{L}\p{M}])*`, 'gu');
const stripStrayScripts = (output, draft, language) => {
    if (!/^(Telugu|Kannada|Hindi)$/.test(language)) return output;
    const keep = String(draft).normalize('NFC');
    const stripped = output.replace(STRAY_RUN, m => keep.includes(m.trim().normalize('NFC')) ? m : '');
    return /[\p{L}\p{N}]/u.test(stripped) ? stripped : output; // never leave a result with no words
};

// Quoted text (straight double, curly double, curly single) is left exactly as written.
const QUOTED = /("[^"]*"|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{M}])'[^']+'(?![\p{L}\p{M}]))/u;

// Formal words that have a plain everyday equivalent with the same meaning, per language. Longer forms come first.
// Each swap keeps the meaning, and none rewrites a passive (that would need a new subject or case).
// What may follow a person's उपलब्धता for the swap to be safe: an optional adverb, then a request verb.
const HINDI_REQUEST = '(?=\\s+(?:(?:जल्दी|जल्द)\\s+)*(?:कन्फर्म|बताइए|बताइये|बताएं|बताएँ|बताओ|बता\\s+(?:दीजिए|दीजिये|दें)|भेजिए|भेजिये|भेजें|भेजो)(?![\\u0900-\\u0963\\u0966-\\u097F]))';
const CASUAL = {
    Telugu: {
        script: 'Telugu', range: 'ఀ-౿',
        formal: /బడ[ిా]|గౌరవనీయ|ధృవీకరించ|నిర్ధారించ|తెలియజేయ|లభ్యత|గలరు|వలన|కారణంగా/,
        swaps: [
            [/వాయిదా వేయబడింది/g, 'వాయిదా పడింది'],
            [/వాయిదా వేయబడిందని/g, 'వాయిదా పడిందని'],
            [/(?:ధృవీకరించగలరా|నిర్ధారించగలరా)/g, 'కన్ఫర్మ్ చేస్తారా'],
            [/(?:ధృవీకరించగలరు|ధృవీకరించండి|నిర్ధారించగలరు|నిర్ధారించండి)/g, 'కన్ఫర్మ్ చేయండి'],
            [/(?:తెలియజేయగలరు|తెలియజేయండి)/g, 'చెప్పండి'],
            // Only a person's availability (after a possessive such as మీ): water or stock "availability" is a different word.
            [/(?<=(?:మీ|నా|నీ|వారి|అతని|ఆమె|గారి)\s+)లభ్యత(ను)?(?![ా-ౖ])/g, 'వీలు$1'],
            [/(?:వలన|కారణంగా)/g, 'వల్ల'],
            [/గౌరవనీయ(?:ులైన)?\s+/g, '']
        ]
    },
    Kannada: {
        script: 'Kannada', range: 'ಀ-೿',
        formal: /ಲಾಗಿದೆ|ಲಾಯಿತು|ಗೌರವಾನ್ವಿತ|ದೃಢೀಕರಿಸ|ದೃಢಪಡಿಸ|ಲಭ್ಯತೆ|ತಿಳಿಸಲು|ವಿನಂತಿ|ಶೀಘ್ರ/,
        swaps: [
            [/ಎಂದು ತಿಳಿಸಲು ಬರೆಯುತ್ತಿದ್ದೇನೆ/g, 'ಅಂತ ಹೇಳ್ತಿದ್ದೀನಿ'],
            [/ದೃಢೀಕರಿಸಬಹುದೇ/g, 'ಕನ್ಫರ್ಮ್ ಮಾಡ್ತೀರಾ'],
            // The model sometimes writes the blunt singular command to the reader; the polite form keeps the same verb.
            [/ಕನ್‌ಫರ್ಮ್ ಮಾಡು(?![ಀ-೿])/g, 'ಕನ್ಫರ್ಮ್ ಮಾಡಿ'],
            [/ಕನ್ಫರ್ಮ್ ಮಾಡು(?![ಀ-೿])/g, 'ಕನ್ಫರ್ಮ್ ಮಾಡಿ'],
            [/(?:ದೃಢೀಕರಿಸಿರಿ|ದೃಢೀಕರಿಸಿ|ದೃಢಪಡಿಸಿ)/g, 'ಕನ್ಫರ್ಮ್ ಮಾಡಿ'],
            [/(?:ಶೀಘ್ರದಲ್ಲೇ|ಶೀಘ್ರದಲ್ಲಿ|ಶೀಘ್ರವೇ|ಶೀಘ್ರವಾಗಿ|ತ್ವರಿತವಾಗಿ)(?![ಀ-೿])/g, 'ಬೇಗ'],
            [/(?<=(?:ನಿಮ್ಮ|ನಿನ್ನ|ನನ್ನ|ಅವರ|ಅವನ|ಅವಳ)\s+)ಲಭ್ಯತೆಯನ್ನು/g, 'ಸಮಯವನ್ನು'],
            [/(?<=(?:ನಿಮ್ಮ|ನಿನ್ನ|ನನ್ನ|ಅವರ|ಅವನ|ಅವಳ)\s+)ಲಭ್ಯತೆ(?![ಀ-೿])/g, 'ಸಮಯ'],
            [/ಗೌರವಾನ್ವಿತ\s+/g, '']
        ]
    },
    // Romanized Hindi: drop the stiff English-letter formulas. Case variants are listed because the swap regexes are case-sensitive.
    Hinglish: {
        script: 'Latin', range: 'A-Za-z',
        formal: /respected|kindly|shighra|confirmation|apekshit|inform karne/i,
        swaps: [
            [/ka (\w+) confirmation (?:dein|dijiye)(?![A-Za-z])/g, '$1 confirm kar dein'],
            [/ka confirmation (?:dein|dijiye)(?![A-Za-z])/g, 'confirm kar dein'],
            [/shighra(?![A-Za-z])/g, 'jaldi'],
            [/Shighra(?![A-Za-z])/g, 'Jaldi'],
            [/Kindly(?![A-Za-z])/g, 'Please'],
            [/Respected\s+/g, '']
        ]
    },
    Hindi: {
        script: 'Devanagari', range: 'ऀ-ॣ०-ॿ',
        formal: /आदरणीय|शीघ्र|पुष्टि|अवगत|सूचित|हेतु|अपेक्षित|उपलब्धता|स्थगित/,
        swaps: [
            [/की पुष्टि (?:करें|कीजिए|कीजिये)(?![ऀ-ॣ०-ॿ])/g, 'कन्फर्म कर दें'],
            [/पुष्टि (?:करें|कीजिए|कीजिये)(?![ऀ-ॣ०-ॿ])/g, 'कन्फर्म कर दें'],
            // A person's availability -> समय, only before a request verb (बताइए, कन्फर्म कर दें, भेजिए): there nothing else in the
            // sentence has to agree with the new masculine noun. The possessive changes gender too (उपलब्धता is feminine).
            [new RegExp('आपकी उपलब्धता' + HINDI_REQUEST, 'g'), 'आपका समय'],
            [new RegExp('अपनी उपलब्धता' + HINDI_REQUEST, 'g'), 'अपना समय'],
            [new RegExp('मेरी उपलब्धता' + HINDI_REQUEST, 'g'), 'मेरा समय'],
            [new RegExp('तुम्हारी उपलब्धता' + HINDI_REQUEST, 'g'), 'तुम्हारा समय'],
            [new RegExp('उनकी उपलब्धता' + HINDI_REQUEST, 'g'), 'उनका समय'],
            [/(?:शीघ्रातिशीघ्र|शीघ्र)(?![ऀ-ॣ०-ॿ])/g, 'जल्दी'],
            [/आदरणीय\s+/g, '']
        ]
    }
};
// A sample counts as conversational when it is mostly in the language's script and uses none of its formal words.
const isConversational = (sample, cfg) => {
    const s = String(sample || '');
    const own = (s.match(new RegExp(String.raw`\p{Script=${cfg.script}}`, 'gu')) || []).filter(c => /\p{L}/u.test(c)).length;
    const letters = (s.match(/\p{L}/gu) || []).length;
    return letters > 0 && own / letters >= 0.6 && !cfg.formal.test(s);
};
// With a conversational sample, replace formal words in a rewrite. Quoted text is left as written.
const casualize = (output, sample, language) => {
    const cfg = CASUAL[language];
    if (!cfg || !isConversational(sample, cfg)) return output;
    return output.split(QUOTED).map((part, i) => i % 2 ? part
        : cfg.swaps.reduce((t, [re, to]) => t.replace(new RegExp('(?<![' + cfg.range + '])' + re.source, 'g'), to), part)).join('');
};

// The model sometimes drops or adds one letter in a Telugu name (రావు -> రవు). Names are found before the honorific
// గారు/గారి.. in the draft; a word before the honorific in the output that is one edit away from a draft name is put back.
const oneEdit = (a, b) => {
    a = [...a]; b = [...b];
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (i === a.length && i === b.length) return false;
    const rest = a.length === b.length ? [a.slice(i + 1), b.slice(i + 1)]
        : a.length > b.length ? [a.slice(i + 1), b.slice(i)] : [a.slice(i), b.slice(i + 1)];
    return rest[0].join('') === rest[1].join('');
};
// Names are found before the honorific in the draft (Telugu గారు.., Kannada ಅವರು..). A word before the honorific in the
// output that is one edit away from exactly one draft name, and is not itself a word of the draft, is put back.
const NAME_CFG = {
    Telugu: { range: 'ఀ-౿', honor: 'గార(?:ు|ి(?:కి|తో|ని|ది)?)' },
    Kannada: { range: 'ಀ-೿', honor: 'ಅವರ(?:ು|ಿಗೆ|ನ್ನು|ೊಂದಿಗೆ|ೇ)?' }
};
const fixNames = (output, draft, language) => {
    const cfg = NAME_CFG[language];
    if (!cfg) return output;
    const find = new RegExp(`([${cfg.range}]+)\\s+${cfg.honor}(?![${cfg.range}])`, 'g');
    const names = new Set();
    String(draft).replace(find, (_, n) => names.add(n));
    if (!names.size) return output;
    const draftWords = new Set(String(draft).match(new RegExp(`[${cfg.range}]+`, 'g')));
    return output.replace(new RegExp(`([${cfg.range}]+)(\\s+${cfg.honor})(?![${cfg.range}])`, 'g'), (m, word, tail) => {
        if ([...draftWords].some(w => w === word || (w.startsWith(word) && [...w].length - [...word].length >= 2))) return m; // a word the draft really has is never "corrected"
        const near = [...names].filter(n => oneEdit(word, n));
        return near.length === 1 ? near[0] + tail : m; // an ambiguous match is left alone
    });
};

// The model sometimes gives the masculine loanword टाइम a feminine possessive ("अपनी टाइम"). Fix only that pairing, in any Hindi output.
const HINDI_POSSESSIVE_MASC = { 'अपनी': 'अपना', 'आपकी': 'आपका', 'मेरी': 'मेरा', 'तुम्हारी': 'तुम्हारा', 'उनकी': 'उनका' };
const HINDI_POSSESSIVE_OBLIQUE = { 'अपनी': 'अपने', 'आपकी': 'आपके', 'मेरी': 'मेरे', 'तुम्हारी': 'तुम्हारे', 'उनकी': 'उनके' };
const HINDI_NOT_WORD = String.raw`[ऀ-ॣ०-ॿ]`;
const HINDI_TIME_OBLIQUE = new RegExp(String.raw`(?<!${HINDI_NOT_WORD})(अपनी|आपकी|मेरी|तुम्हारी|उनकी)(\s+)टाइम(?=\s+(?:पर|से|को|में|तक|के|का|की)(?!${HINDI_NOT_WORD}))`, 'g');
const HINDI_TIME_DIRECT = new RegExp(String.raw`(?<!${HINDI_NOT_WORD})(अपनी|आपकी|मेरी|तुम्हारी|उनकी)(\s+)टाइम(?!${HINDI_NOT_WORD})(?!\s+मशीन)`, 'g');
const fixHindiGender = (output, language) => language !== 'Hindi' ? output
    : output.split(QUOTED).map((part, i) => i % 2 ? part
        : part.replace(HINDI_TIME_OBLIQUE, (m, who, space) => HINDI_POSSESSIVE_OBLIQUE[who] + space + 'टाइम')
              .replace(HINDI_TIME_DIRECT, (m, who, space) => HINDI_POSSESSIVE_MASC[who] + space + 'टाइम')).join('');

module.exports = {
    fixHindiGender,
    fixNames,
    fixTeluguNames: fixNames,
    detectLanguage,
    draftLanguage,
    stripStrayScripts,
    casualize,
    casualizeTelugu: casualize,
    casualizeKannada: casualize,
    casualizeHindi: casualize,
    isConversationalTelugu: sample => isConversational(sample, CASUAL.Telugu),
    isConversationalKannada: sample => isConversational(sample, CASUAL.Kannada),
    isConversationalHinglish: sample => isConversational(sample, CASUAL.Hinglish),
    isConversationalHindi: sample => isConversational(sample, CASUAL.Hindi)
};
