import {pathToFileURL} from 'node:url';import path from 'node:path';
const {totalAnswerCard}=await import(pathToFileURL(process.env.POLICY_MODULE||path.resolve('worker/policy.js')));
const e={unit:'천원',year:2026,id:'test',page_url:'https://example.org/'};
for(const [name,text,expected] of [
 ['malformed comma','합계 1,00\n일반회계 70\n특별회계 30',false],
 ['decimal prefix','합계 100.5\n일반회계 70\n특별회계 30',false],
 ['suffix','합계 100원\n일반회계 70\n특별회계 30',false],
 ['cross-line','합계\n100\n일반회계 70\n특별회계 30',false],
 ['valid grouping','합 계 1,000\n일반회계 900\n특별회계 100',true]
]){const out=totalAnswerCard({...e,text});console.log(JSON.stringify({name,accepted:!!out,expected,pass:!!out===expected}));}
