import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {execute}=createRequire(import.meta.url)('../src/services/execution.service');
const samples=[
 {name:'Java scores example',codeLanguage:'Java',code:'public class Main { static int findLargest(int[] a) { int largest=a[0]; for(int x:a) if(x>largest) largest=x; return largest; } public static void main(String[] args) { int[] scores={72,85,91,68,88}; int total=0; for(int score:scores)total+=score; double average=(double)total/scores.length; System.out.println("Average: "+average); System.out.println("Highest: "+findLargest(scores)); System.out.println(average>=80?"Great performance!":"Keep practising!"); } }',inputs:[],status:'Completed',stdout:'Average: 80.8\nHighest: 91\nGreat performance!\n'},
 {name:'C++ pre-supplied input',codeLanguage:'C++',code:'#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n*2;}',inputs:['21'],status:'Completed',stdout:'42'},
 {name:'Java compiler error',codeLanguage:'Java',code:'public class Main { public static void main(String[] args) { System.out.println(42) } }',inputs:[],status:'CompilationError'},
 {name:'JavaScript infinite loop',codeLanguage:'JavaScript',code:'while (true) {}',inputs:[],status:'TimeLimitExceeded'}
];
const results=[];
for(const sample of samples){
 const result=await execute(sample);results.push({name:sample.name,...result});
 assert.equal(result.status,200);assert.equal(result.body.data.status,sample.status);
 if(sample.stdout!==undefined)assert.equal(result.body.data.stdout,sample.stdout);
 console.log(sample.name+': '+sample.status+' verified');
}
const output=new URL('../../../outputs/Dev-Editor-Execution-Edge-Cases.json',import.meta.url);
await mkdir(new URL('./',output),{recursive:true});await writeFile(output,JSON.stringify(results,null,2));
