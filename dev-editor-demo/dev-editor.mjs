import {run} from './runner.js';
const $=id=>document.getElementById(id);
const examples={loop:'total = 0\nfor i in range(3):\n    total += i\nprint(total)',sort:'numbers = [4, 1, 3, 2]\nfor i in range(len(numbers)):\n    for j in range(len(numbers) - 1 - i):\n        if numbers[j] > numbers[j + 1]:\n            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\nprint(numbers)',recursion:'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nprint(factorial(4))',error:'numbers = [10, 20, 30]\nprint(numbers[3])'};
let trace=null,source='',position=0,playing=null,controller=null,aiController=null;
const aiCache=new Map();
function pause(){clearInterval(playing);playing=null;$('play').textContent='Play';}
function addText(parent,tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;parent.append(el);return el;}
export function narrate(step,hinglish=false){
    const where=step.causedBy==null?'':hinglish?`Line ${step.causedBy} ke baad: `:`Since line ${step.causedBy}: `;
    const changes=step.changed.filter(name=>name!=='input').slice(0,4).map(name=>`${name} = ${step.vars[name]}`).join('; ');
    if(step.event==='exception')return hinglish?`${step.exception} exception aaya. Yeh handle bhi ho sakta hai; final result neeche dekho.`:`A ${step.exception} exception occurred. It may be handled; check the final result below.`;
    if(step.event==='return')return (step.stack.length===1&&step.stack[0]==='<module>'?
        (hinglish?'Code ka execution yahan khatam hua. ':'Code execution ended here. '):
        (hinglish?'Yeh function ab return kar raha hai. ':'This function is returning. '))+(changes?where+changes:'');
    return where+(changes?(hinglish?'Values badli hain: ':'Values changed: ')+changes+'. ':'')+
        (step.event==='call'?(hinglish?'Function mein enter kar rahe hain.':'Entering this frame.'):
        hinglish?`Ab line ${step.line} chalegi.`:`About to run line ${step.line}.`);
}
function lineOptions(){
    updateLineNumbers();
    const lines=$('code').value.split('\n');$('why-line').max=lines.length;
    const selected=Number($('why-line').value);
    if(!Number.isInteger(selected)||selected<1||selected>lines.length)$('why-line').value='1';
    linePreview();
}
function updateLineNumbers(){
    const count=$('code').value.split('\n').length;
    $('code-line-numbers').textContent=Array.from({length:count},(_,index)=>index+1).join('\n');
    $('code-line-count').textContent=`${count} ${count===1?'line':'lines'} · ${$('code').value.length.toLocaleString()} / 12,000 characters`;
    $('code-gutter').scrollTop=$('code').scrollTop;
}
$('code').onscroll=()=>{$('code-gutter').scrollTop=$('code').scrollTop;};
function linePreview(){
    const line=Number($('why-line').value),text=$('code').value.split('\n')[line-1];
    const valid=Number.isInteger(line)&&line>=1&&typeof text==='string'&&!!text.trim();
    $('why').disabled=!valid;$('why').textContent=valid?`Explain line ${line}`:'Explain line';
    $('selected-source').textContent=valid?`${line}  ${text}`:'Choose a valid non-empty line.';
    return valid;
}
function render(followLine=true){
    if(!trace)return;const step=trace.steps[position];$('empty').hidden=true;$('trace-view').hidden=false;
    if(followLine&&step?.line>0)$('why-line').value=String(step.line);
    linePreview();$('fix').disabled=false;
    $('fix-help').textContent=trace.error?`Captured ${trace.error.type}. Click Fix my error to explain it and suggest a correction.`:'No error was captured in this run. Load an error example and click Run & explore to try error help.';
    $('step-label').textContent=step?`${position+1} / ${trace.steps.length}`:'No recorded steps';
    $('timeline').max=Math.max(0,trace.steps.length-1);$('timeline').value=position;
    $('prev').disabled=!step||position===0;$('next').disabled=!step||position===trace.steps.length-1;$('play').disabled=!step;
    $('lines').replaceChildren();source.split('\n').forEach((text,index)=>{const row=addText($('lines'),'button','','code-line'+(step?.line===index+1?' active':''));row.type='button';row.title=`Select line ${index+1} for explanation`;row.setAttribute('aria-label',`Select line ${index+1}: ${text}`);row.onclick=()=>{$('why-line').value=String(index+1);$('why-line').onchange();$('why').focus();};addText(row,'span',String(index+1),'line-number');row.append(document.createTextNode(text));});
    $('lines').querySelector('.active')?.scrollIntoView({block:'nearest'});
    $('narration').textContent=step?narrate(step,$('language').value==='Hinglish'):'Execution ended before a snapshot was recorded.';
    $('variables').replaceChildren();$('array-view').replaceChildren();$('variable-detail').textContent='';
    for(const [name,value]of Object.entries(step?.vars||{})){
        if(name==='input')continue;
        const button=addText($('variables'),'button',`${name}  ${value}`,step.changed.includes(name)?'changed':'');
        button.onclick=()=>{const earlier=trace.steps.slice(0,position).reverse().find(s=>JSON.stringify(s.stack)===JSON.stringify(step.stack)&&name in s.vars);$('variable-detail').textContent=`${name}: ${earlier?.vars[name]??'not previously recorded'} → ${value}. `+(step.changed.includes(name)?`Observed since line ${step.causedBy??'entry'}.`:'No recorded change at this step.');};
        // Display only unambiguous flat numeric lists; never evaluate Python text.
        if(/^\[\s*(-?\d+(?:\.\d+)?\s*(,\s*-?\d+(?:\.\d+)?\s*)*)?\]$/.test(value)){
            const values=value.slice(1,-1).split(',').map(x=>x.trim()).filter(Boolean).slice(0,30);
            addText($('array-view'),'p',name,'array-name');const cells=addText($('array-view'),'div','','array-cells');
            values.forEach((v,i)=>{const cell=addText(cells,'div',v,'array-cell');addText(cell,'small',String(i));});
        }
    }
    $('stack').textContent=step?.stack.join(' → ')||'—';$('stdout').textContent=step?.stdout||'(no output yet)';
    $('error').textContent=trace.error?`${trace.error.type}: ${trace.error.message}`:'';
    $('limits').textContent=(trace.meta.truncated?`Partial trace — ${trace.meta.stopReason}. `:'')+'Snapshots show state before each line; a changed value belongs to the preceding observed line in that frame.';
}
$('example').onchange=()=>{$('code').value=examples[$('example').value];invalidate();};
function invalidate(){pause();aiController?.abort();trace=null;lineOptions();$('trace-view').hidden=true;$('empty').hidden=false;$('fix').disabled=false;$('fix-help').textContent='Run the current code to capture an error first.';$('ai-result').hidden=true;$('ai-state').textContent='';$('run-state').textContent='Code changed. Run again for a fresh trace.';}
$('try-error').onclick=()=>{$('example').value='error';$('code').value=examples.error;invalidate();$('run-state').textContent='Error example loaded. Click Run & explore; then use Fix my error.';$('run').focus();};
$('code').oninput=$('inputs').oninput=invalidate;
$('language').onchange=()=>{aiController?.abort();$('ai-result').hidden=true;$('ai-state').textContent='';render(false);};
$('why-line').onchange=()=>{
    pause();aiController?.abort();$('ai-result').hidden=true;$('ai-state').textContent='';
    if(!linePreview()){$('line-help').textContent='Enter a non-empty line number within your code.';return;}
    const line=Number($('why-line').value);
    const matches=trace?.steps.map((step,index)=>({step,index})).filter(item=>item.step.line===line&&item.step.event==='line')||[];
    const match=matches.find(item=>item.index>=position)||matches[0];
    if(match){position=match.index;render(false);}
    $('line-help').textContent=match?`Line ${line} selected at recorded step ${match.index+1}. Click Explain line ${line} to get an answer.`:`Line ${line} selected. Click Explain line ${line} for a source-only explanation; no recorded execution is available.`;
};
$('why-line').oninput=()=>{aiController?.abort();$('ai-result').hidden=true;linePreview();$('ai-state').textContent='Line selection changed. Click Explain line to request its explanation.';};
$('why-line').onkeydown=event=>{if(event.key==='Enter'&&!$('why').disabled){event.preventDefault();assist('why');}};
$('cursor-line').onclick=()=>{$('why-line').value=String($('code').value.slice(0,$('code').selectionStart).split('\n').length);$('why-line').onchange();};
$('timeline').oninput=()=>{pause();position=Number($('timeline').value);render();};
$('prev').onclick=()=>{pause();position=Math.max(0,position-1);render();};
$('next').onclick=()=>{pause();position=Math.min(trace.steps.length-1,position+1);render();};
$('play').onclick=()=>{if(playing){pause();return;}if(position>=trace.steps.length-1)position=0;$('play').textContent='Pause';playing=setInterval(()=>{render();if(position>=trace.steps.length-1)pause();else position++;},650);};
$('stop').onclick=()=>controller?.abort();
$('run').onclick=async()=>{
    pause();aiController?.abort();controller=new AbortController();source=$('code').value;trace=null;$('why').disabled=$('fix').disabled=true;
    $('trace-view').hidden=true;$('empty').hidden=false;$('ai-result').hidden=true;$('ai-state').textContent='';pause();
    $('prev').disabled=$('next').disabled=$('play').disabled=$('timeline').disabled=true;
    $('run').disabled=true;$('why-line').disabled=true;$('try-error').disabled=true;$('stop').disabled=false;$('code').readOnly=true;$('example').disabled=true;$('inputs').readOnly=true;$('run-state').textContent='Loading Python, then recording…';
    try{trace=await run(source,$('inputs').value?$('inputs').value.split('\n'):[],{signal:controller.signal});position=0;render();$('run-state').textContent=`${trace.meta.stopReason||'Completed'} · ${trace.steps.length} steps · ${trace.meta.executionMs??'?'} ms execution`;}
    catch(error){$('run-state').textContent=error.message;}
    finally{$('run').disabled=false;$('why-line').disabled=false;$('why').disabled=!$('why-line').value;$('try-error').disabled=false;$('fix').disabled=false;$('stop').disabled=true;$('code').readOnly=false;$('example').disabled=false;$('inputs').readOnly=false;$('timeline').disabled=false;}
};
async function assist(mode){
    if(mode==='error'&&!trace?.error){$('ai-state').textContent='No captured error to fix yet. Click Load an error example, then Run & explore. No AI request was sent.';return;}
    const code=$('code').value;if(!code.trim())return;
    const selectedLine=Number($('why-line').value);
    if(mode==='why'&&(!Number.isInteger(selectedLine)||selectedLine<1||!code.split('\n')[selectedLine-1]?.trim())){$('ai-state').textContent='Choose a non-empty line to explain.';return;}
    const step=trace?.steps[position]?.line===selectedLine?trace.steps[position]:undefined;
    const payload={code,mode,language:$('language').value,...(mode==='why'?{selectedLine}:{}),steps:(mode==='why'?[step]:trace?.steps.filter(s=>s.changed.length||s.event==='exception').slice(-12)||[]).filter(Boolean).map(s=>({line:s.line,event:s.event,changed:s.changed,vars:Object.fromEntries(Object.entries(s.vars).filter(([name])=>s.changed.includes(name))),causedBy:s.causedBy})),error:trace?.error||null};
    aiController?.abort();
    const key=JSON.stringify(payload);if(aiCache.has(key)){$('ai-result').hidden=false;$('ai-result').textContent=aiCache.get(key);$('ai-state').textContent='Reused this explanation. No new AI request.';return;}
    aiController=new AbortController();const requestController=aiController;$('ai-state').textContent=mode==='why'?`Explaining line ${selectedLine}…`:'Requesting an explanation…';$('ai-result').hidden=true;$('ai-state').scrollIntoView({block:'nearest'});
    try{const response=await fetch('/assist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:requestController.signal});const data=await response.json();if(requestController.signal.aborted)return;if(!response.ok||!data.success)throw Error(data.error?.message||'Explanation unavailable. Your local trace still works.');if(aiCache.size>=20)aiCache.delete(aiCache.keys().next().value);aiCache.set(key,data.data);$('ai-result').hidden=false;$('ai-result').textContent=data.data;$('ai-state').textContent='AI interpretation — verify important claims against your code and tests.';}
    catch(error){if(error.name!=='AbortError')$('ai-state').textContent=error.message;}
}
$('explain').onclick=()=>assist('explain');$('why').onclick=()=>assist('why');$('fix').onclick=()=>assist('error');
lineOptions();
