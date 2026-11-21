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
