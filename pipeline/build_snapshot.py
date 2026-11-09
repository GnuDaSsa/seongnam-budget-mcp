"""Build bounded gzip static shards; no raw PDFs or secrets in Site source."""
import gzip, json, re, sqlite3, shutil
from collections import defaultdict
from pathlib import Path
from collect import ROOT, DATA, export

OUT=ROOT/'snapshot'
def save(name,obj):
    payload=json.dumps(obj,ensure_ascii=False,separators=(',',':')).encode()
    p=OUT/name; p.parent.mkdir(parents=True,exist_ok=True)
    p.write_bytes(gzip.compress(payload,compresslevel=6,mtime=0))
    return len(payload),p.stat().st_size

def terms(text):
    words=re.findall(r'[가-힣]+|[a-z]+|\d[\d,]*',text.lower())
    result=set()
    for word in words:
        if len(word)<2: continue
        if re.fullmatch('[가-힣]+',word):
            result.update(word[i:i+2] for i in range(len(word)-1))
        else: result.add(word)
    return result

def run():
    export()
    OUT.mkdir(exist_ok=True)
    catalog=json.loads((DATA/'catalog.json').read_text(encoding='utf-8'))
    if (DATA/'source-audit.json').exists(): catalog['summary']['additional_sources']=json.loads((DATA/'source-audit.json').read_text(encoding='utf-8'))
    c=sqlite3.connect(DATA/'budget.sqlite'); c.row_factory=sqlite3.Row
    groups=defaultdict(list)
    for p in c.execute('SELECT pages.*,documents.metadata FROM pages JOIN documents ON documents.id=pages.document_id ORDER BY document_id,page'):
        year=json.loads(p['metadata']).get('year') or 'unknown'
        groups[year].append(dict(p))
    shards=[]; document_shards=defaultdict(set); routing=defaultdict(list); total=0
    for year,rows in sorted(groups.items(),key=lambda x:str(x[0]),reverse=True):
        for start in range(0,len(rows),1000):
            part=rows[start:start+1000]; name=f'{year}-{start//1000}'
            postings=defaultdict(list); pages=[]; texts=[]
            for i,r in enumerate(part):
                member=re.match(r'\[ZIP 내부 파일: (.+); PDF 페이지: (\d+)\]',r['text'])
                location={'member':member[1],'page':int(member[2])} if member else None
                pages.append([r['document_id'],r['page'],r['unit'],r['printed_page'],r['text_hash'],len(r['text']),location])
                texts.append(r['text'])
                for t in terms(r['text']): postings[t].append(i)
                document_shards[r['document_id']].add(name)
            raw,zipped=save(f'corpus/index-{name}.json.gz',{'pages':pages,'terms':postings})
            for term in postings:routing[term].append(name)
            _,textsize=save(f'corpus/text-{name}.json.gz',texts)
            shards.append({'id':name,'year':year,'pages':len(part),'index_bytes':zipped,'text_bytes':textsize})
            total+=zipped+textsize
            print(json.dumps({'shard':name,'pages':len(part),'bytes':zipped+textsize}),flush=True)
    _,routing_bytes=save('corpus/routing.json.gz',routing)
    total+=routing_bytes
    for d in catalog['documents']: d['shards']=sorted(document_shards[d['id']])
    catalog['shards']=shards
    catalog['routing']='routing'
    catalog['summary']['search_engine']='Korean n-gram lexical retrieval; generation by connected ChatGPT'
    catalog['summary']['snapshot_bytes']=total
    catalog['summary']['snapshot_units']=sum(s['pages'] for s in shards)
    catalog['summary']['snapshot_pages']=sum(d['indexed_pages'] for d in catalog['documents'])
    catalog['summary']['snapshot_text_blocks']=sum(d.get('indexed_units',0) for d in catalog['documents'])
    catalog['summary']['snapshot_documents']=sum(bool(d['shards']) for d in catalog['documents'])
    (OUT/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    # Only obsolete generated shards inside the resolved snapshot/corpus directory.
    valid={'routing.json.gz'}|{f'{kind}-{s["id"]}.json.gz' for s in shards for kind in ['index','text']}
    corpus=(OUT/'corpus').resolve()
    for p in corpus.glob('*.json.gz'):
        if p.resolve().parent==corpus and p.name not in valid:p.unlink()
    print(json.dumps({'shards':len(shards),'snapshot_bytes':total,'units':catalog['summary']['snapshot_units']}))
    from build_terms import run as build_terms
    build_terms()

if __name__=='__main__': run()
