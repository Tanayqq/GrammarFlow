import {run} from './runner.js';
const $=id=>document.getElementById(id);
const examples={loop:'total = 0\nfor i in range(3):\n    total += i\nprint(total)',sort:'numbers = [4, 1, 3, 2]\nfor i in range(len(numbers)):\n    for j in range(len(numbers) - 1 - i):\n        if numbers[j] > numbers[j + 1]:\n            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\nprint(numbers)',recursion:'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nprint(factorial(4))',error:'numbers = [10, 20, 30]\nprint(numbers[3])'};
let trace=null,source='',position=0,playing=null,controller=null,aiController=null;
const languageExamples={"Python": "total = 0\nfor i in range(3):\n    total += i\nprint(total)", "JavaScript": "const numbers = [1, 2, 3];\nlet total = 0;\nfor (const n of numbers) {\n  total += n;\n}\nconsole.log(total);", "TypeScript": "const numbers: number[] = [1, 2, 3];\nconst total: number = numbers.reduce((sum, n) => sum + n, 0);\nconsole.log(total);", "Java": "class Main {\n  public static void main(String[] args) {\n    int total = 0;\n    for (int i = 1; i <= 3; i++) total += i;\n    System.out.println(total);\n  }\n}", "C": "#include <stdio.h>\nint main(void) {\n  int total = 0;\n  for (int i = 1; i <= 3; i++) total += i;\n  printf(\"%d\\n\", total);\n  return 0;\n}", "C++": "#include <iostream>\nint main() {\n  int total = 0;\n  for (int i = 1; i <= 3; ++i) total += i;\n  std::cout << total << \"\\n\";\n}", "C#": "using System;\nclass Program {\n  static void Main() {\n    int total = 0;\n    for (int i = 1; i <= 3; i++) total += i;\n    Console.WriteLine(total);\n  }\n}", "Go": "package main\nimport \"fmt\"\nfunc main() {\n  total := 0\n  for i := 1; i <= 3; i++ { total += i }\n  fmt.Println(total)\n}", "Rust": "fn main() {\n  let numbers = [1, 2, 3];\n  let total: i32 = numbers.iter().sum();\n  println!(\"{}\", total);\n}", "PHP": "<?php\n$numbers = [1, 2, 3];\n$total = array_sum($numbers);\necho $total;", "Ruby": "numbers = [1, 2, 3]\ntotal = numbers.sum\nputs total", "SQL": "CREATE TABLE expenses (category TEXT, amount INTEGER);\nINSERT INTO expenses VALUES ('Books', 10), ('Books', 20), ('Food', 5);\nSELECT category, SUM(amount) AS total\nFROM expenses\nGROUP BY category\nORDER BY total DESC;"};
const aiCache=new Map();
const rustConcepts=[["Reverse / BinaryHeap", "\\b(Reverse|BinaryHeap)\\b", "BinaryHeap normally pops the largest item first. Reverse reverses comparison order, so wrapped entries can be popped smallest first. For distance-node pairs, distance is compared first.", "BinaryHeap aam taur par sabse bada item pehle nikalta hai. Reverse comparison ka order ulta karta hai, isliye wrapped entries mein sabse chhoti value pehle aa sakti hai. Distance-node pair mein pehle distance compare hota hai."], ["Debug / Clone / Copy", "\\b(Debug|Clone|Copy)\\b", "Debug enables debugging output such as {:?}. Clone provides explicit duplication with .clone(). Copy allows implicit value copying on assignment instead of moving ownership; it does not mean a deep copy of heap data.", "Debug se {:?} format mein debugging ke liye value dikhate hain. Clone se .clone() call karke duplicate banate hain. Copy assignment par ownership move karne ke bajay value copy hone deta hai; iska matlab heap data ki deep copy nahi hai."], ["usize / u64", "\\b(usize|u64)\\b", "usize is an unsigned integer whose width matches the target pointer width; it is commonly used for indexing. u64 is a 64-bit unsigned integer. Both have finite ranges; choosing a larger type does not prevent overflow.", "usize ek unsigned integer hai jiska size target ke pointer width ke barabar hota hai; indexing mein iska istemal hota hai. u64 ek 64-bit unsigned integer hai. Dono ki range limited hai; bada type lene se overflow ki sambhavna khatam nahi hoti."], ["checked_add", "\\bchecked_add\\b", "For integer addition, checked_add returns Some(sum) when the result fits, or None on overflow. It does not wrap the result around or silently return zero.", "Integer addition mein checked_add ka result fit hone par Some(sum) milta hai; overflow par None milta hai. Yeh result ko wrap karke chhota number ya chupke se zero nahi banata."], ["Option / Result and ?", "\\?|\\b(Option|Result)\\b", "For Option, ? extracts a Some value or returns None from the enclosing function. For Result, it extracts Ok or propagates Err. It is not an unwrap() call and does not make preceding array indexing bounds-safe.", "Option par ? ko Some milne se uski value milti hai; None milne par poora function None return karta hai. Result par Ok ki value milti hai ya Err aage return hota hai. Yeh unwrap() call nahi hai aur array indexing ko bounds-safe nahi banata."], ["Nested vectors", "Vec\\s*<\\s*Vec\\s*<", "Vec<Vec<T>> is a list of lists. In an adjacency-list graph, each node has a list of its connected edges; the outer index selects a node and the inner list holds its edges.", "Vec<Vec<T>> lists ki ek list hai. Adjacency-list wale graph mein har node ki connected edges ki alag list hoti hai; bahar ka index node chunta hai aur andar ki list uski edges rakhti hai."]];
function conceptGuide(text,label){
 const matches=$('code-language').value==='Rust'?rustConcepts.filter(item=>new RegExp(item[1]).test(text)):[];
 $('concept-guide').hidden=!matches.length;$('concept-definitions').replaceChildren();
 $('concept-title').textContent='Related Rust concepts - '+label;
 for(const [name,pattern,english,hinglish]of matches){addText($('concept-definitions'),'dt',name);addText($('concept-definitions'),'dd',$('language').value==='Hinglish'?hinglish:english);}
}

function executionAvailable(){return !!$('code').value.trim()&&$('code').value.length<=60000&&$('code').value.split('\n').length<=1000;}
async function runRemote(code,inputs,signal){
 const response=await fetch('/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,inputs,codeLanguage:$('code-language').value}),signal});
 const body=await response.json();if(!response.ok||!body.success)throw Error(body.error?.message||'The external code runner is unavailable.');
 const result=body.data;if(!result||typeof result.stdout!=='string'||typeof result.stderr!=='string'||typeof result.compileOutput!=='string')throw Error('Invalid execution result.');
 return {meta:{language:result.language,executionKind:'remote',truncated:result.outputMayBeTruncated,stopReason:result.error?'error':null,executionMs:result.executionMs},steps:[],stdout:result.stdout,stderr:result.stderr,compileOutput:result.compileOutput,error:result.error};
}
function rangePreview(){
 const lines=$('code').value.split('\n'),start=Number($('range-start').value),valid=Number.isInteger(start)&&start>=1&&start<=lines.length;
 $('range-start').max=lines.length;$('line-batch').disabled=!valid;
 $('range-prev').disabled=!valid||start===1;$('range-next').disabled=!valid||start+10>lines.length;
 $('line-batch').textContent=valid?`Explain lines ${start}–${Math.min(start+9,lines.length)}`:'Choose a starting line';
 $('range-preview').textContent=valid?lines.slice(start-1,start+9).map((line,i)=>`${start+i}  ${line}`).join('\n'):'Choose a valid starting line.';
 conceptGuide(valid?lines.slice(start-1,start+9).join('\n'):'',valid?'lines '+start+'-'+Math.min(start+9,lines.length):'selection');
}
function executionControls(){
 const python=$('code-language').value==='Python';
 $('run').disabled=!executionAvailable();$('example').disabled=!python;$('example').hidden=!python;$('inputs').disabled=false;$('try-error').disabled=!python;$('try-error').hidden=!python;
 const local=python&&$('code').value.length<=12000;
 $('execution-help').textContent=local?'Python runs on your device: 500 recorded steps and a 3-second execution limit. Longer programs run on Judge0.':'Run sends this code and test inputs to Judge0 for compilation/execution. Do not include secrets. Single-file programs only; Java needs class Main. Remote runs show real output/errors, not variable snapshots.';
 $('empty-help').textContent=local?'Run Python for real snapshots, or use line-by-line source explanations below.':'Run your code for real output and errors, then explore the source line by line below. Remote execution does not record variable snapshots.';
 $('run').textContent=local?'Run & explore':'Run on Judge0';
}

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
    linePreview();rangePreview();
}
function updateLineNumbers(){
    const count=$('code').value.split('\n').length;
    $('code-line-numbers').textContent=Array.from({length:count},(_,index)=>index+1).join('\n');
    $('code-line-count').textContent=`${count} / 1,000 lines · ${$('code').value.length.toLocaleString()} / 60,000 characters`;
    $('code-gutter').scrollTop=$('code').scrollTop;
}
$('code').onscroll=()=>{$('code-gutter').scrollTop=$('code').scrollTop;};
function linePreview(){
    const line=Number($('why-line').value),text=$('code').value.split('\n')[line-1];
    const valid=Number.isInteger(line)&&line>=1&&typeof text==='string'&&!!text.trim();
    $('why').disabled=!valid;$('why').textContent=valid?`Explain line ${line}`:'Explain line';
    $('selected-source').textContent=valid?`${line}  ${text}`:'Choose a valid non-empty line.';
    conceptGuide(valid?text:'','line '+line);
    return valid;
}
function render(followLine=true){
    if(!trace)return;const remote=trace.meta.executionKind==='remote';const step=trace.steps[position];
    $('recording-kind').textContent=remote?'REAL PROGRAM RESULT - '+trace.meta.language:'RECORDED EXECUTION';
    $('remote-diagnostics').hidden=!remote;
    $('remote-stderr').textContent=trace.stderr||'(none)';$('remote-compile').textContent=trace.compileOutput||'(none)';$('empty').hidden=true;$('trace-view').hidden=false;
    if(followLine&&step?.line>0)$('why-line').value=String(step.line);
    $('python-details').hidden=remote;$('timeline-controls').hidden=remote;linePreview();$('fix').disabled=false;
    $('fix-help').textContent=trace.error?`Captured ${trace.error.type}. Click Fix my error to explain it and suggest a correction.`:'No error was captured. Edit your code and run again to investigate a failure.';
    $('step-label').textContent=remote?'Output and diagnostics':step?`${position+1} / ${trace.steps.length}`:'No recorded steps';
    $('timeline').max=Math.max(0,trace.steps.length-1);$('timeline').value=position;
    $('prev').disabled=!step||position===0;$('next').disabled=!step||position===trace.steps.length-1;$('play').disabled=!step;
    $('lines').replaceChildren();source.split('\n').forEach((text,index)=>{const row=addText($('lines'),'button','','code-line'+(step?.line===index+1?' active':''));row.type='button';row.title=`Select line ${index+1} for explanation`;row.setAttribute('aria-label',`Select line ${index+1}: ${text}`);row.onclick=()=>{$('why-line').value=String(index+1);$('why-line').onchange();$('why').focus();};addText(row,'span',String(index+1),'line-number');row.append(document.createTextNode(text));});
    $('lines').querySelector('.active')?.scrollIntoView({block:'nearest'});
    $('narration').textContent=step?narrate(step,$('language').value==='Hinglish'):remote?'This is real execution output from Judge0. Use Explain line or line-by-line explanations to explore the source; no variable trace was recorded.':'Execution ended before a snapshot was recorded.';
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
    $('stack').textContent=step?.stack.join(' → ')||'—';$('stdout').textContent=(remote?trace.stdout:step?.stdout)||(remote?'(program produced no output)':'(no output yet)');
    $('error').textContent=trace.error?`${trace.error.type}: ${trace.error.message}`:'';
    $('limits').textContent=remote?'Single-file execution on Judge0 with time, memory and output limits. Stop stops waiting; a submitted job may finish remotely. '+(trace.meta.truncated?'Output may be truncated.':''):(trace.meta.truncated?`Partial trace — ${trace.meta.stopReason}. `:'')+'Snapshots show state before each line; a changed value belongs to the preceding observed line in that frame.';
}
$('example').onchange=()=>{$('code').value=examples[$('example').value];invalidate();};
function invalidate(){pause();aiController?.abort();trace=null;$('range-start').value='1';lineOptions();executionControls();$('trace-view').hidden=true;$('empty').hidden=false;$('fix').disabled=false;$('fix-help').textContent='Run the code to capture a compiler or runtime error first.';$('ai-result').hidden=true;$('ai-state').textContent='';$('run-state').textContent=executionAvailable()?'Code changed. Run again for a fresh trace.':'Use up to 1,000 lines / 60,000 characters to run or explain code.';}
$('try-error').onclick=()=>{$('example').value='error';$('code').value=examples.error;invalidate();$('run-state').textContent='Error example loaded. Click Run & explore; then use Fix my error.';$('run').focus();};
$('code').oninput=$('inputs').oninput=invalidate;
$('code-language').onchange=()=>{invalidate();$('run-state').textContent=executionAvailable()?'Ready to run. Check where execution happens above.':'Use up to 1,000 lines / 60,000 characters.';};
$('load-language-example').onclick=()=>{$('code').value=languageExamples[$('code-language').value];invalidate();};
$('range-start').oninput=()=>{aiController?.abort();$('ai-result').hidden=true;$('ai-state').textContent='Range changed. Click Explain lines to request an answer.';rangePreview();};
$('range-prev').onclick=()=>{$('range-start').value=Math.max(1,Number($('range-start').value)-10);$('range-start').oninput();};
$('range-next').onclick=()=>{$('range-start').value=Math.min($('code').value.split('\n').length,Number($('range-start').value)+10);$('range-start').oninput();};
$('line-batch').onclick=()=>assist('lines');
$('language').onchange=()=>{aiController?.abort();$('ai-result').hidden=true;$('ai-state').textContent='';render(false);rangePreview();};
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
    if(!executionAvailable()){$('run-state').textContent='Use up to 1,000 lines / 60,000 characters to run code.';return;}
    $('code-language').disabled=$('load-language-example').disabled=true;
    pause();aiController?.abort();controller=new AbortController();source=$('code').value;trace=null;$('why').disabled=$('fix').disabled=true;
    $('trace-view').hidden=true;$('empty').hidden=false;$('ai-result').hidden=true;$('ai-state').textContent='';pause();
    $('prev').disabled=$('next').disabled=$('play').disabled=$('timeline').disabled=true;
    $('run').disabled=true;$('why-line').disabled=true;$('try-error').disabled=true;$('stop').disabled=false;$('code').readOnly=true;$('example').disabled=true;$('inputs').readOnly=true;$('run-state').textContent=$('code-language').value==='Python'&&source.length<=12000?'Loading Python and recording...':'Compiling/running on Judge0...';
    try{const inputs=$('inputs').value?$('inputs').value.split('\n'):[];trace=$('code-language').value==='Python'&&source.length<=12000?await run(source,inputs,{signal:controller.signal}):await runRemote(source,inputs,controller.signal);position=0;render();$('run-state').textContent=`${trace.meta.stopReason||'Completed'} · ${trace.meta.executionKind==='remote'?'remote result':trace.steps.length+' steps'} · ${trace.meta.executionMs??'?'} ms execution`;}
    catch(error){$('run-state').textContent=error.name==='AbortError'?'Stopped waiting. A submitted remote job may still finish.':error.message;}
    finally{$('code-language').disabled=$('load-language-example').disabled=false;executionControls();$('why-line').disabled=false;$('why').disabled=!$('why-line').value;$('try-error').disabled=false;$('fix').disabled=false;$('stop').disabled=true;$('code').readOnly=false;$('example').disabled=false;$('inputs').readOnly=false;$('timeline').disabled=false;}
};
async function assist(mode){
    if(mode==='error'&&!trace?.error){$('ai-state').textContent='No captured error to fix yet. Click Load an error example, then Run & explore. No AI request was sent.';return;}
    const code=$('code').value;if(!code.trim())return;
    if(code.length>60000||code.split('\n').length>1000||code.split('\n').some(line=>line.length>1000)){$('ai-state').textContent='Use up to 1,000 lines / 60,000 characters, with up to 1,000 characters per line.';return;}
    const rangeStart=Number($('range-start').value);
    if(mode==='lines'&&(!Number.isInteger(rangeStart)||rangeStart<1||rangeStart>code.split('\n').length)){$('ai-state').textContent='Choose a valid starting line.';return;}
    const selectedLine=Number($('why-line').value);
    if(mode==='why'&&(!Number.isInteger(selectedLine)||selectedLine<1||!code.split('\n')[selectedLine-1]?.trim())){$('ai-state').textContent='Choose a non-empty line to explain.';return;}
    const step=trace?.steps[position]?.line===selectedLine?trace.steps[position]:undefined;
    const payload={code,mode,codeLanguage:$('code-language').value,...(mode==='lines'?{rangeStart}:{}),language:$('language').value,...(mode==='why'?{selectedLine}:{}),steps:(mode==='why'?[step]:trace?.steps.filter(s=>s.changed.length||s.event==='exception').slice(-12)||[]).filter(Boolean).map(s=>({line:s.line,event:s.event,changed:s.changed,vars:Object.fromEntries(Object.entries(s.vars).filter(([name])=>s.changed.includes(name))),causedBy:s.causedBy})),error:trace?.error||null};
    aiController?.abort();
    const key=JSON.stringify(payload);if(aiCache.has(key)){$('ai-result').hidden=false;$('ai-result').textContent=aiCache.get(key);$('ai-state').textContent='Reused this explanation. No new AI request.';return;}
    aiController=new AbortController();const requestController=aiController;$('ai-state').textContent=mode==='lines'?`Explaining lines ${rangeStart}–${Math.min(rangeStart+9,code.split('\n').length)}…`:mode==='why'?`Explaining line ${selectedLine}…`:'Requesting an explanation…';$('ai-result').hidden=true;$('ai-state').scrollIntoView({block:'nearest'});
    try{const response=await fetch('/assist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:requestController.signal});const data=await response.json();if(requestController.signal.aborted)return;if(!response.ok||!data.success)throw Error(data.error?.message||'Explanation unavailable. Your local trace still works.');if(aiCache.size>=20)aiCache.delete(aiCache.keys().next().value);aiCache.set(key,data.data);$('ai-result').hidden=false;$('ai-result').textContent=data.data;$('ai-state').textContent=data.source==='local'?'Blank lines labelled without calling the AI provider.':mode==='lines'?'AI source explanation — selected lines only; no code was executed.': 'AI interpretation — verify important claims against your code and tests.';}
    catch(error){if(error.name!=='AbortError')$('ai-state').textContent=error.message;}
}
$('explain').onclick=()=>assist('explain');$('why').onclick=()=>assist('why');$('fix').onclick=()=>assist('error');
lineOptions();executionControls();
