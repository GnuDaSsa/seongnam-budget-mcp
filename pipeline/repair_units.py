"""Repair unit provenance without changing source text or search postings."""
import gzip,json
from collect import db,ROOT,extract_unit,now
c=db();mapping={};updates=[]
for doc,page,text,unit in c.execute('SELECT document_id,page,text,unit FROM pages'):
    correct=extract_unit(text);mapping[(doc,page)]=correct
    if correct!=unit:updates.append((correct,doc,page))
c.executemany('UPDATE pages SET unit=? WHERE document_id=? AND page=?',updates);c.commit();c.close()
out=ROOT/'snapshot';catalog=json.loads((out/'catalog.json').read_text(encoding='utf-8'));changed=0
for shard in catalog['shards']:
    prefix='pages' if catalog.get('term_buckets') else 'index'
    p=out/'corpus'/f'{prefix}-{shard["id"]}.json.gz';data=json.loads(gzip.decompress(p.read_bytes()));dirty=False
    for row in data['pages']:
        correct=mapping[(row[0],row[1])]
        if row[2]!=correct:row[2]=correct;dirty=True;changed+=1
    if dirty:p.write_bytes(gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),compresslevel=6,mtime=0))
    shard['index_bytes']=p.stat().st_size
catalog['summary']['quality_updated_at']=now()
catalog['summary']['unit_policy']='금액 단위 표기에서 원/천원/백만원/억원만 추출. 단위사업 명칭은 금액 단위가 아님. 복수 단위는 함께 표시.'
search_bytes=sum(p.stat().st_size for p in (out/'corpus').glob('terms-*.json.gz')) if catalog.get('term_buckets') else (out/'corpus/routing.json.gz').stat().st_size
catalog['summary']['snapshot_bytes']=sum(s['index_bytes']+s['text_bytes'] for s in catalog['shards'])+search_bytes
(out/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(json.dumps({'database_rows_fixed':len(updates),'snapshot_rows_fixed':changed}))
