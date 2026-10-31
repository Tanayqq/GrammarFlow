// Every worker message is untrusted, including messages forged by user Python.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value, max) => typeof value === 'string' && value.length <= max;
const strings = (value, count, length) => Array.isArray(value) && value.length <= count && value.every(x=>string(x,length));
export function validStep(step) {
    return object(step) && Number.isInteger(step.i) && step.i>=0 && step.i<500 &&
        Number.isInteger(step.line) && step.line>=0 && step.line<=12000 &&
        ['call','line','return','exception'].includes(step.event) && object(step.vars) &&
        Object.keys(step.vars).length<=51 && Object.entries(step.vars).every(([k,v])=>string(k,80)&&string(v,220)) &&
        strings(step.changed,51,80) && strings(step.deleted,51,80) && strings(step.stack,40,80) &&
        (step.causedBy===null || Number.isInteger(step.causedBy)&&step.causedBy>=0&&step.causedBy<=12000) &&
        string(step.stdout,4020) && (step.returnValue===undefined||string(step.returnValue,220)) &&
        (step.exception===undefined||string(step.exception,80));
}
export function normalizeResult(value) {
    try {
        if(!object(value)||!object(value.meta)||value.meta.language!=='python'||typeof value.meta.truncated!=='boolean'||
            ![null,'step_limit','trace_size_limit','output_limit','error','timeout','startup_timeout','cancelled','runner_error','invalid_result'].includes(value.meta.stopReason)||
            !Array.isArray(value.steps)||value.steps.length>500||!value.steps.every(validStep)||
            !string(value.stdout,4020)||JSON.stringify(value).length>4000000) return null;
        let error=null;
        if(value.error!==null){
            if(!object(value.error)||!string(value.error.type,80)||!string(value.error.message,400))return null;
            if(value.error.frames!==undefined&&(!Array.isArray(value.error.frames)||value.error.frames.length>40||
                !value.error.frames.every(f=>object(f)&&Number.isInteger(f.line)&&string(f.function,80))))return null;
            error={type:value.error.type,message:value.error.message};
            if(value.error.frames)error.frames=value.error.frames;
            if(string(value.error.stage,80))error.stage=value.error.stage;
            if(Number.isInteger(value.error.line))error.line=value.error.line;
        }
        return {meta:{language:'python',truncated:value.meta.truncated,stopReason:value.meta.stopReason,
            ...(string(value.meta.lineSemantics,400)?{lineSemantics:value.meta.lineSemantics}:{}),
            ...(typeof value.meta.cspBlocksUIOrigin==='boolean'?{cspBlocksUIOrigin:value.meta.cspBlocksUIOrigin}:{})},
            steps:value.steps,stdout:value.stdout,error};
    } catch {return null;}
}
