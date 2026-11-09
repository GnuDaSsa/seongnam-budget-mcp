"""Query-sized global posting buckets: never load the entire vocabulary at runtime."""
import gzip,json
from collections import defaultdict
from collect import ROOT

def bucket(word):
    h=2166136261
    for b in word.encode('utf-8'):h=((h^b)*16777619)&0xffffffff
    return h&255

def run():
    out=ROOT/'snapshot';corpus=(out/'corpus').resolve()
    catalog=json.loads((out/'catalog.json').read_text(encoding='utf-8'))
    terms=[defaultdict(list) for _ in range(256)];start=0
    for shard in catalog['shards']:
        p=corpus/f'index-{shard["id"]}.json.gz';data=json.loads(gzip.decompress(p.read_bytes()))
        for word,post in data['terms'].items():terms[bucket(word)][word].extend(start+i for i in post)
        target=corpus/f'pages-{shard["id"]}.json.gz'
        target.write_bytes(gzip.compress(json.dumps({'pages':data['pages']},ensure_ascii=False,separators=(',',':')).encode(),compresslevel=6,mtime=0))
        shard['offset']=start;shard['index_bytes']=target.stat().st_size;start+=shard['pages']
    sizes=[]
    for i,values in enumerate(terms):
        p=corpus/f'terms-{i:02x}.json.gz';p.write_bytes(gzip.compress(json.dumps(values,ensure_ascii=False,separators=(',',':')).encode(),compresslevel=6,mtime=0));sizes.append(p.stat().st_size)
    catalog.pop('routing',None);catalog['term_buckets']=256
    catalog['summary']['search_layout']='Query term buckets + small page metadata shards'
    catalog['summary']['snapshot_bytes']=sum(s['index_bytes']+s['text_bytes'] for s in catalog['shards'])+sum(sizes)
    catalog['summary']['max_term_bucket_bytes']=max(sizes)
    (out/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    # Retire generated vocabulary shards only after the replacement is complete.
    for p in list(corpus.glob('index-*.json.gz'))+[corpus/'routing.json.gz']:
        if p.exists() and p.resolve().parent==corpus:p.unlink()
    print(json.dumps({'buckets':len(sizes),'bucket_bytes':sum(sizes),'max_bucket_bytes':max(sizes),'total_bytes':catalog['summary']['snapshot_bytes']}),flush=True)

if __name__=='__main__':run()
