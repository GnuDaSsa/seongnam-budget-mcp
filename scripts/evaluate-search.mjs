import {writeFile} from 'node:fs/promises';
const base=process.argv[2]||'http://127.0.0.1:8765';
const cases=[
 ['어르신이 일할 수 있도록 돕는 사업',2026,['노인','일자리']],
 ['아이를 맡기는 시설 지원',2026,['어린이집','보육']],
 ['청년 주거비 지원',2026,['청년','주거']],
 ['거동이 불편한 주민의 교통편',2026,['교통','장애']],
 ['출산한 가정에 주는 지원금',2026,['출산','산후']],
 ['주민이 책을 빌려 읽을 수 있는 곳',2026,['도서관','도서']],
 ['노인일자리',2007,['노인','일자리']],
 ['도서관',null,['도서관']],
];
const rows=[];
for(let [query,year,expected] of cases){
 let p=new URLSearchParams({query,limit:5});if(year)p.set('year',year);
 let r=await fetch(base+'/api/search?'+p),d=await r.json();
 let row={query,year,http:r.status,retrieval:d.retrieval,expected_terms:expected,expected_term_present:d.results?.some(h=>expected.some(w=>h.excerpt.includes(w))),hits:d.results?.map(h=>({title:h.title,page:h.page,year:h.year,score:h.score,scores:h.retrieval_scores,excerpt:h.excerpt,source_url:h.source_url}))};rows.push(row);
 console.log(JSON.stringify({...row,hits:row.hits?.slice(0,2).map(h=>({...h,excerpt:h.excerpt.slice(0,500)}))}));
}
await writeFile('docs/semantic-search-evaluation.json',JSON.stringify({base,checked_at:new Date().toISOString(),method:'Expected-term smoke check; not independently labelled relevance benchmark',rows},null,2));
