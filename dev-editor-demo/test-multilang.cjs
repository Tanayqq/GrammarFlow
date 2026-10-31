const assert=require('node:assert/strict');
const {requestFor,parseLines}=require('./assistant.cjs');
const languages=['Python','JavaScript','TypeScript','Java','C','C++','C#','Go','Rust','PHP','Ruby','SQL'];
const code=Array.from({length:1000},(_,i)=>`const value_${i+1} = ${i+1}; // source line ${i+1}`).join('\n');
for(const codeLanguage of languages){
    const body={code,codeLanguage,language:'English',mode:'lines',rangeStart:991};
    const prompt=requestFor(body),payload=JSON.parse(prompt.text);
    assert.ok(prompt.system.includes(codeLanguage+' tutor'));
    assert.equal(payload.contextIncomplete,true);assert.ok(prompt.text.length<17000);
    assert.equal(payload.selectedLines.length,10);assert.equal(payload.selectedLines[9].line,1000);
    assert.ok(payload.sourceExcerpt.some(item=>item.line===1000&&item.code.includes('value_1000')));
    const lines=payload.selectedLines.map(item=>({line:item.line,explanation:'This line declares a constant.'}));
    assert.match(parseLines(JSON.stringify({lines,caveat:'Partial source only.'}),body),/Line 1000:/);
    assert.equal(parseLines(JSON.stringify({lines:lines.slice(1),caveat:''}),body),null);
    assert.equal(parseLines(JSON.stringify({lines:lines.map(item=>({...item,line:991})),caveat:''}),body),null);
}
const base={code:'x = 1\n\nprint(x)',codeLanguage:'Python',language:'Hinglish',mode:'lines',rangeStart:1};
const rows=[1,2,3].map(line=>({line,explanation:'Yeh line code ka ek hissa samjhati hai aur yahan structure dikhati hai.'}));
assert.ok(parseLines(JSON.stringify({lines:rows,caveat:'Yeh sirf source ka explanation hai.'}),base));
assert.equal(parseLines(JSON.stringify({lines:rows.map(row=>({...row,explanation:'This line declares a variable.'})),caveat:''}),base),null);
for(const rangeStart of [0,1.5,1001])assert.throws(()=>requestFor({...base,rangeStart}));
assert.throws(()=>requestFor({...base,code:'x\n'.repeat(1000)}));
assert.throws(()=>requestFor({...base,codeLanguage:'unknown'}));
assert.throws(()=>requestFor({...base,codeLanguage:'Java',steps:[{line:1}]}));
assert.throws(()=>requestFor({...base,code:'x'.repeat(1001)}));
const {JSDOM}=require('jsdom');const fs=require('node:fs');
const dom=new JSDOM(fs.readFileSync(__dirname+'/dev-editor.html','utf8'),{runScripts:'outside-only',url:'http://127.0.0.1:8786/dev-editor.html'});
const w=dom.window,$=id=>w.document.getElementById(id);let runs=0,requests=[];
w.HTMLElement.prototype.scrollIntoView=function(){};w.run=async()=>{runs++;throw Error('Must not execute');};
w.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({success:true,data:'Line 991: Explanation.'})};};
w.eval(fs.readFileSync(__dirname+'/dev-editor.mjs','utf8').replace(/^import [^\r\n]*\r?\n/,'').replace('export function narrate','function narrate'));
(async()=>{
    assert.deepEqual(Array.from($('code-language').options,o=>o.value),languages);
    for(const language of languages){$('code-language').value=language;$('code-language').onchange();$('load-language-example').onclick();assert.ok($('code').value.length>0);assert.equal($('run').disabled,language!=='Python');}
    $('code-language').value='JavaScript';$('code-language').onchange();$('code').value=code;$('code').oninput();
    assert.equal($('run').disabled,true);await $('run').onclick();assert.equal(runs,0);
    $('range-start').value='991';$('range-start').oninput();assert.match($('range-preview').textContent,/1000  const value_1000/);
    assert.equal($('range-next').disabled,true);await $('line-batch').onclick();
    assert.equal(requests[0].codeLanguage,'JavaScript');assert.equal(requests[0].mode,'lines');assert.equal(requests[0].rangeStart,991);
    await $('line-batch').onclick();assert.equal(requests.length,1,'replay is cached');
    $('range-prev').onclick();assert.equal($('range-start').value,'981');
    assert.equal($('ai-result').hidden,true,'range change invalidates answer');
    $('code-language').value='Python';$('code-language').onchange();assert.equal($('run').disabled,true,'long Python is explanation only');
    console.log('12 language prompts/examples and 1,000-line source pagination, bounded context, validated coverage and cache checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>dom.window.close());
