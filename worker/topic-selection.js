// 질문의 편성 범위 안에서 본예산 사업과 추경을 함께 보여 준다.
export function topicEditionOrder(items, documentFor, limit) {
 const base=items.filter(item=>documentFor(item).budget_type==='본예산');
 const other=items.filter(item=>documentFor(item).budget_type!=='본예산');
 if(!other.length)return items;
 const count=Math.min(base.length,Math.ceil(limit*(limit<=5?0.8:0.6)));
 const selected=new Set(base.slice(0,count));
 const first=[],rest=[],seen=new Set(base.slice(0,count).map(item=>{
  const doc=documentFor(item);return [doc.year,doc.budget_type,doc.revision||0].join(':');
 }));
 for(const item of items){
  if(selected.has(item))continue;
  const doc=documentFor(item),key=[doc.year,doc.budget_type,doc.revision||0].join(':');
  if(!seen.has(key)){seen.add(key);first.push(item);}else rest.push(item);
 }
 return [...base.slice(0,count),...first,...rest];
}

// 같은 사업명은 부서가 달라도 후순위에 두고, 항목 자체는 보존한다.
export function distinctTopicBusinesses(items, excerptFor) {
 const seen=new Set(),first=[],repeated=[];
 for(const item of items){
  const excerpt=String(excerptFor(item)||'');
  const name=excerpt.split(/\s{2,}(?=[△▲-]?\d)/)[0].replace(/\s/g,'').toLowerCase();
  if(!name||!seen.has(name)){if(name)seen.add(name);first.push(item);}else repeated.push(item);
 }
 return [...first,...repeated];
}
