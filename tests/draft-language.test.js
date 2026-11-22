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
