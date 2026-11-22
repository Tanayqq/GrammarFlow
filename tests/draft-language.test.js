const test = require('node:test');
const assert = require('node:assert/strict');
const { draftLanguage } = require('../src/utils/language');

test('the draft decides the language, whatever the menu says', () => {
    assert.equal(draftLanguage('నా స్నేహితుడు రవి ఈ రోజు వచ్చాడు.', 'English'), 'Telugu');
    assert.equal(draftLanguage('ನನ್ನ ಸ್ನೇಹಿತ ರವಿ ಇಂದು ಬಂದನು.', 'English'), 'Kannada');
    assert.equal(draftLanguage('मेरा दोस्त रवि आज आया।', 'Telugu'), 'Hindi');
    assert.equal(draftLanguage('I went to the market and bought some fruit.', 'Telugu'), 'English');
});

test('a few English words inside a Kannada or Telugu sentence do not change the language', () => {
    assert.equal(draftLanguage('ನಾನು office ಗೆ ಹೋದೆ ಮತ್ತು meeting ಮುಗಿಸಿದೆ.', 'English'), 'Kannada');
    assert.equal(draftLanguage('నేను office కి వెళ్ళాను, meeting అయ్యింది.', 'English'), 'Telugu');
});

test('one stray foreign word in an English draft does not switch language', () => {
    assert.equal(draftLanguage('We visited the temple and heard the word ನಮಸ್ಕಾರ from the priest at the gate.', 'English'), 'English');
});

test('Hinglish and romanized drafts keep the menu where the text cannot settle it', () => {
    assert.equal(draftLanguage('kal main office jaunga aur phir ghar aunga', 'English'), 'Hinglish');
    assert.equal(draftLanguage('hello', 'Hinglish'), 'Hinglish');
    assert.equal(draftLanguage('nenu ippudu chaala kastam lo unnanu', 'Telugu'), 'Telugu');
    assert.equal(draftLanguage('nanu tumba kashta padtidini', 'Kannada'), 'Kannada');
});

test('empty or symbol-only text falls back to the menu', () => {
    assert.equal(draftLanguage('', 'Kannada'), 'Kannada');
    assert.equal(draftLanguage('123 !!!', 'Hindi'), 'Hindi');
});

test('digits and long English drafts do not trigger a non-English language', () => {
    assert.equal(draftLanguage('Order १२३४५ now.', 'English'), 'English');
    const long = 'The committee reviewed the quarterly numbers and agreed that the plan should go ahead next month.';
    assert.equal(draftLanguage(long, 'Hinglish'), 'English');
});

test('a stray Greek or Cyrillic word is removed from Indian-language output, but not from English or the draft', () => {
    const { stripStrayScripts } = require('../src/utils/language');
    assert.equal(stripStrayScripts('మీ లభ్యతను όσο త్వరగా చెప్పండి', 'మీ లభ్యత', 'Telugu'), 'మీ లభ్యతను త్వరగా చెప్పండి');
    assert.equal(stripStrayScripts('తెలుగు слово.', 'తెలుగు', 'Kannada'), 'తెలుగు.');
    assert.equal(stripStrayScripts('రేడియస్ π పొడవు', 'వ్యాసార్థం π', 'Telugu'), 'రేడియస్ π పొడవు', 'kept when the draft had it');
    assert.equal(stripStrayScripts('keep όσο here', 'draft', 'English'), 'keep όσο here');
});

test('stray-script removal also takes attached marks, and never empties a result', () => {
    const { stripStrayScripts } = require('../src/utils/language');
    assert.equal(stripStrayScripts('మీ లభ్యతను ο\u0301σο త్వరగా చెప్పండి', 'మీ లభ్యత', 'Telugu'), 'మీ లభ్యతను త్వరగా చెప్పండి');
    assert.equal(stripStrayScripts('слово', 'తెలుగు', 'Telugu'), 'слово');
    assert.equal(stripStrayScripts('слово.', 'తెలుగు', 'Telugu'), 'слово.');
});

const CASUAL_TE = 'హాయ్ - చిన్న మాట. నేను చిన్నగా రాస్తాను, పెద్ద పరిచయాలు ఉండవు. చెప్పాల్సింది చెప్పేసి ఆపేస్తాను. '
    + 'కామాలు తక్కువ, డాష్‌లు ఎక్కువ. కొన్నిసార్లు చిన్న జోక్ - సరిపోతేనే. చదివినందుకు థాంక్స్, కొంచెం సూటిగా ఉంటే సారీ.';

test('a casual Telugu sample gets formal words swapped for everyday ones, meaning kept', () => {
    const { casualizeTelugu } = require('../src/utils/language');
    const out = casualizeTelugu('గౌరవనీయులైన రావు గారికి, సమావేశం కారణంగా వాయిదా వేయబడింది. మీ లభ్యతను తెలియజేయండి. దయచేసి ధృవీకరించగలరా?', CASUAL_TE, 'Telugu');
    assert.equal(out, 'రావు గారికి, సమావేశం వల్ల వాయిదా పడింది. మీ వీలును చెప్పండి. దయచేసి కన్ఫర్మ్ చేస్తారా?');
});

test('no swap for formal samples, other languages, no sample, or quoted text', () => {
    const { casualizeTelugu, isConversationalTelugu } = require('../src/utils/language');
    const formal = 'గౌరవనీయులైన అధికారులకు, తెలియజేయడానికి వ్రాస్తున్నాను. '.repeat(6);
    const text = 'మీ లభ్యతను తెలియజేయండి.';
    assert.equal(isConversationalTelugu(formal), false);
    assert.equal(isConversationalTelugu('I write short and plain, no long intros at all. '.repeat(6)), false, 'English sample says nothing about Telugu register');
    assert.equal(casualizeTelugu(text, formal, 'Telugu'), text);
    assert.equal(casualizeTelugu(text, CASUAL_TE, 'English'), text);
    assert.equal(casualizeTelugu(text, '', 'Telugu'), text);
    assert.equal(casualizeTelugu('అతను "మీ లభ్యతను తెలియజేయండి" అన్నాడు. మీ లభ్యతను చెప్పండి.', CASUAL_TE, 'Telugu'),
        'అతను "మీ లభ్యతను తెలియజేయండి" అన్నాడు. మీ వీలును చెప్పండి.');
});

test('a Telugu name changed by one letter is put back, other words are left alone', () => {
    const { fixTeluguNames } = require('../src/utils/language');
    const draft = 'గౌరవనీయులైన రావు గారికి, సమావేశం వాయిదా.';
    assert.equal(fixTeluguNames('రవు గారికి - సమావేశం వాయిదా పడింది.', draft, 'Telugu'), 'రావు గారికి - సమావేశం వాయిదా పడింది.');
    assert.equal(fixTeluguNames('హాయ్ రావు గారు, సరే.', draft, 'Telugu'), 'హాయ్ రావు గారు, సరే.');
    assert.equal(fixTeluguNames('సీత గారికి - సరే.', draft, 'Telugu'), 'సీత గారికి - సరే.', 'a different name stays');
    assert.equal(fixTeluguNames('రవు గారికి', draft, 'English'), 'రవు గారికి', 'Telugu only');
    assert.equal(fixTeluguNames('రవు గారికి', 'సమావేశం వాయిదా', 'Telugu'), 'రవు గారికి', 'no honorific name in the draft, nothing to match');
});

test('swaps do not fire inside longer words, and mixed-language samples are not "mostly Telugu"', () => {
    const { casualizeTelugu, isConversationalTelugu } = require('../src/utils/language');
    assert.equal(casualizeTelugu('అకారణంగా వచ్చాడు. కారణంగా వెళ్ళాడు.', CASUAL_TE, 'Telugu'), 'అకారణంగా వచ్చాడు. వల్ల వెళ్ళాడు.');
    assert.equal(isConversationalTelugu('మీరు okay? ' + 'sure thing, okay. '.repeat(10)), false);
});

test('name repair never swaps one real person for another', () => {
    const { fixTeluguNames } = require('../src/utils/language');
    assert.equal(fixTeluguNames('రామ గారు రమ గారి గురించి మాట్లాడారు.', 'రామ గారు రమ గురించి మాట్లాడారు.', 'Telugu'),
        'రామ గారు రమ గారి గురించి మాట్లాడారు.', 'a word that is in the draft stays');
    assert.equal(fixTeluguNames('రామ గారు వచ్చారు. రమ గారు వెళ్లారు.', 'రామ గారు వచ్చారు. రమా గారు వెళ్లారు.', 'Telugu'),
        'రామ గారు వచ్చారు. రమ గారు వెళ్లారు.', 'two near names: no guess');
});

test('name repair needs a whole honorific word and respects suffixed names in the draft', () => {
    const { fixTeluguNames } = require('../src/utils/language');
    assert.equal(fixTeluguNames('రమ గార్డెన్‌లో ఉన్నారు.', 'రామ గార్డెన్‌లో ఉన్నారు.', 'Telugu'), 'రమ గార్డెన్‌లో ఉన్నారు.');
    assert.equal(fixTeluguNames('రామ గారు రమ గారితో మాట్లాడారు.', 'రామ గారు రమతో మాట్లాడారు.', 'Telugu'), 'రామ గారు రమ గారితో మాట్లాడారు.');
    assert.equal(fixTeluguNames('రవు గారికి', 'రావు గారికి', 'Telugu'), 'రావు గారికి');
});

test('name repair fixes a truncated name but keeps a name the draft has with a suffix', () => {
    const { fixTeluguNames } = require('../src/utils/language');
    assert.equal(fixTeluguNames('రావ గారికి', 'రావు గారికి', 'Telugu'), 'రావు గారికి');
});

test('name repair: a one-letter difference is a typo, a longer suffixed form in the draft is a real word', () => {
    const { fixTeluguNames } = require('../src/utils/language');
    assert.equal(fixTeluguNames('కమ గారు', 'కమల గారు', 'Telugu'), 'కమల గారు');
    assert.equal(fixTeluguNames('రామ గారు రమ గారితో మాట్లాడారు.', 'రామ గారు రమతోనే మాట్లాడారు.', 'Telugu'), 'రామ గారు రమ గారితో మాట్లాడారు.');
});

test('లభ్యత is swapped with or without its ను ending', () => {
    const { casualizeTelugu } = require('../src/utils/language');
    assert.equal(casualizeTelugu('మీ లభ్యత త్వరగా చెప్పండి. మీ లభ్యతను చెప్పండి.', CASUAL_TE, 'Telugu'), 'మీ వీలు త్వరగా చెప్పండి. మీ వీలును చెప్పండి.');
});

test('లభ్యత swap is for a person\'s availability only, and only for the whole word', () => {
    const { casualizeTelugu } = require('../src/utils/language');
    assert.equal(casualizeTelugu('నీటి లభ్యత తక్కువగా ఉంది.', CASUAL_TE, 'Telugu'), 'నీటి లభ్యత తక్కువగా ఉంది.');
    assert.equal(casualizeTelugu('మీ లభ్యతే ముఖ్యం.', CASUAL_TE, 'Telugu'), 'మీ లభ్యతే ముఖ్యం.');
});

test('లభ్యత swap covers a named person (గారి) but not our stock (మా)', () => {
    const { casualizeTelugu } = require('../src/utils/language');
    assert.equal(casualizeTelugu('రావు గారి లభ్యతను చెప్పండి.', CASUAL_TE, 'Telugu'), 'రావు గారి వీలును చెప్పండి.');
    assert.equal(casualizeTelugu('బియ్యం స్టాక్: మా లభ్యత 100 కిలోలు', CASUAL_TE, 'Telugu'), 'బియ్యం స్టాక్: మా లభ్యత 100 కిలోలు');
});
