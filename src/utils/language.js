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

// The model sometimes drops a stray Greek or Cyrillic word into Telugu/Kannada/Hindi output. Remove it, unless the draft had it.
const stripStrayScripts = (output, draft, language) => {
    if (!/^(Telugu|Kannada|Hindi)$/.test(language)) return output;
    const keep = String(draft).normalize('NFC');
    // Greek, Greek Extended and Cyrillic letters plus their combining marks.
    const stripped = output.replace(/[ \t]*[Ͱ-Ͽἀ-῿Ѐ-ӿ][̀-ͯͰ-Ͽἀ-῿Ѐ-ӿ]*/g,
        m => keep.includes(m.trim().normalize('NFC')) ? m : '');
    return /[\p{L}\p{N}]/u.test(stripped) ? stripped : output; // never leave a result with no words
};

// Formal Telugu words that have a plain everyday equivalent with the same meaning. Order matters: longer forms first.
const TELUGU_CASUAL_SWAPS = [
    [/వాయిదా వేయబడింది/g, 'వాయిదా పడింది'],
    [/వాయిదా వేయబడిందని/g, 'వాయిదా పడిందని'],
    [/(?:ధృవీకరించగలరా|నిర్ధారించగలరా)/g, 'కన్ఫర్మ్ చేస్తారా'],
    [/(?:ధృవీకరించగలరు|ధృవీకరించండి|నిర్ధారించగలరు|నిర్ధారించండి)/g, 'కన్ఫర్మ్ చేయండి'],
    [/(?:తెలియజేయగలరు|తెలియజేయండి)/g, 'చెప్పండి'],
    // Only a person's availability (after a possessive such as మీ): water or stock "availability" is a different word.
    [/(?<=(?:మీ|నా|నీ|వారి|అతని|ఆమె|గారి)\s+)లభ్యత(ను)?(?![ా-ౖ])/g, 'వీలు$1'],
    [/(?:వలన|కారణంగా)/g, 'వల్ల'],
    [/గౌరవనీయ(?:ులైన)?\s+/g, '']
];
const FORMAL_TELUGU = /బడ[ిా]|గౌరవనీయ|ధృవీకరించ|నిర్ధారించ|తెలియజేయ|లభ్యత|గలరు|వలన|కారణంగా/;

// A sample counts as conversational when it is mostly Telugu and uses none of the formal words above.
const isConversationalTelugu = sample => {
    const s = String(sample || '');
    const telugu = (s.match(/\p{Script=Telugu}/gu) || []).filter(c => /\p{L}/u.test(c)).length;
    const letters = (s.match(/\p{L}/gu) || []).length;
    return letters > 0 && telugu / letters >= 0.6 && !FORMAL_TELUGU.test(s);
};

// With a conversational sample, replace formal Telugu words in a rewrite. Text inside quote marks is left as written.
const casualizeTelugu = (output, sample, language) => {
    if (language !== 'Telugu' || !isConversationalTelugu(sample)) return output;
    return output.split(/("[^"]*"|“[^”]*”)/).map((part, i) =>
        i % 2 ? part : TELUGU_CASUAL_SWAPS.reduce((t, [re, to]) => t.replace(new RegExp('(?<![\u0C00-\u0C7F])' + re.source, 'g'), to), part)).join('');
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
const fixTeluguNames = (output, draft, language) => {
    if (language !== 'Telugu') return output;
    const names = new Set();
    String(draft).replace(/([ఀ-౿]+)\s+గార(?:ు|ి(?:కి|తో|ని|ది)?)(?![ఀ-౿])/g, (_, n) => names.add(n));
    if (!names.size) return output;
    const draftWords = new Set(String(draft).match(/[ఀ-౿]+/g));
    return output.replace(/([ఀ-౿]+)(\s+గార(?:ు|ి(?:కి|తో|ని|ది)?)(?![ఀ-౿]))/g, (m, word, tail) => {
        if ([...draftWords].some(w => w === word || (w.startsWith(word) && [...w].length - [...word].length >= 2))) return m; // a word the draft really has is never "corrected"
        const near = [...names].filter(n => oneEdit(word, n));
        return near.length === 1 ? near[0] + tail : m; // an ambiguous match is left alone
    });
};

module.exports = {
    fixTeluguNames,
    detectLanguage,
    draftLanguage,
    stripStrayScripts,
    casualizeTelugu,
    isConversationalTelugu
};
