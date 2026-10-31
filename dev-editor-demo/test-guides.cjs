const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {JSDOM}=require('jsdom');
const {isRomanHinglish}=require('../src/utils/documentLanguage');
const source=readFileSync(__dirname+'/dev-editor.mjs','utf8');
const guides=JSON.parse(source.match(/const conceptGuides=([\s\S]*?);\nfunction conceptGuide/)[1]);
const dom=new JSDOM(readFileSync(__dirname+'/dev-editor.html','utf8'),{runScripts:'outside-only',url:'http://127.0.0.1:8786/dev-editor.html'});
const w=dom.window,$=id=>w.document.getElementById(id);let requests=0,runs=0;
w.HTMLElement.prototype.scrollIntoView=function(){};
w.fetch=async()=>{requests++;throw Error('Guide must not call AI');};w.run=async()=>{runs++;throw Error('Guide must not run code');};
w.eval(source.replace(/^import [^\r\n]*\r?\n/,'').replace('export function narrate','function narrate'));
try{
    const languages=Array.from($('code-language').options,item=>item.value);
    assert.equal(Object.keys(guides).length,12);
    for(const language of languages){
        assert.ok(guides[language].length>=4,language+' has a useful reference set');
        for(const [name,pattern,english,hinglish]of guides[language]){
            assert.ok(name&&pattern&&english.length>30);new RegExp(pattern);
            assert.ok(isRomanHinglish(hinglish,{stripMarkdown:false}),language+': '+name+' uses Roman Hinglish');
        }
        $('code-language').value=language;$('code-language').onchange();$('load-language-example').onclick();
        $('language').value='English';$('language').onchange();
        assert.equal($('concept-guide').hidden,false,language+' sample has matching notes');
        assert.ok($('concept-title').textContent.startsWith('Related '+language+' concepts'));
        const english=$('concept-definitions').textContent;
        $('language').value='Hinglish';$('language').onchange();
        assert.notEqual($('concept-definitions').textContent,english,language+' toggle changes the definitions');
        $('why-line').value='1';$('why-line').onchange();assert.match($('concept-title').textContent,/line 1/);
    }
    $('code-language').value='SQL';$('code-language').onchange();$('code').value='select count(*) from expenses where amount > 0';$('code').oninput();
    assert.match($('concept-definitions').textContent,/COUNT/,'SQL detection is case-insensitive');
    $('code').value='\n\n';$('code').oninput();assert.equal($('concept-guide').hidden,true,'blank selections hide stale notes');
    assert.equal(requests,0);assert.equal(runs,0);
    console.log('All 12 local guides: bilingual definitions, source selection, switching, SQL case handling and zero network/execution calls passed.');
}finally{dom.window.close();}
