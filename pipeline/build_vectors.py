"""Build reproducible, bounded static vector assets for the anonymous Worker.

Model2Vec Potion (BGE-M3 distilled), symmetric int8 token vectors, mean+L2.
All searchable text is covered by overlapping chunks; no first-page truncation.
The model revision, source hashes, coverage and quantization error are recorded.
"""
import gzip, hashlib, json, math, struct, sys, time, unicodedata
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if (ROOT.parent/'rag-libs').exists(): sys.path.insert(0,str(ROOT.parent/'rag-libs'))
import numpy as np
from safetensors.numpy import load_file
from tokenizers import Tokenizer

MODEL='minishlab/potion-multilingual-128M'
REV='73908c3438cf03b6a01bcb9611d62b23d0726f08'
DIM=256
OUT=ROOT/'snapshot/semantic'
SRC=ROOT/'work/models/potion'

def save(name,data):
    (OUT/name).write_bytes(gzip.compress(data,compresslevel=6,mtime=0))
def norm(t):
    # Same documented Tokenizers.js Precompiled approximation in both runtimes.
    import re
    t=re.sub('[\u0001-\u0008\u000b\u000e-\u001f\u007f\u008f\u009f]','',t)
    t=re.sub('[\u0009\u000a\u000c\u000d\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u2581\u3000\ufeff\ufffd]',' ',t)
    t='\uff5e'.join(unicodedata.normalize('NFKC',x) for x in t.split('\uff5e'))
    t=re.sub(r'([!"#$%&\'()*+,\-./:;<=>?@\[\\\]^_`{|}~])',r' \1 ',t)
    return re.sub(r'\s+',' ',t).strip()
def normalize(v):
    return v/np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-20)
def quantize(v):
    scale=np.maximum(np.abs(v).max(axis=1),1e-20)/127
    q=np.rint(v/scale[:,None]).clip(-127,127).astype('i1')
    return q,scale.astype('<f4')
def chunks(text,size=800,overlap=120):
    # Offsets are Unicode code points; the Worker uses Array.from when slicing.
    start=0
    while start<len(text):
        end=min(start+size,len(text))
        if end<len(text):
            cut=text.rfind('\n',start+size//2,end)
            if cut>start+size//2:end=cut+1
        yield start,end,text[start:end]
        if end==len(text):break
        start=max(start+1,end-overlap)

def run():
    begin=time.time(); OUT.mkdir(parents=True,exist_ok=True)
    config=json.loads((SRC/'tokenizer.json').read_text('utf-8'))
    vocab=config['model']['vocab']
    # Offline tokenizer uses the identical explicit normalization as JS.
    config['normalizer']=None
    tok=Tokenizer.from_str(json.dumps(config,ensure_ascii=False)); tok.no_truncation()
    raw=load_file(SRC/'model.safetensors')['embeddings']
    q,scales=quantize(raw); weights=q.astype('f4')*scales[:,None]
    rng=np.random.default_rng(42); sample=rng.choice(len(raw),5000,replace=False)
    cos=np.sum(normalize(raw[sample])*normalize(weights[sample]),axis=1)
    print(json.dumps({'model_loaded':MODEL,'quantization_mean_cosine':float(cos.mean())}),flush=True)
    del raw
    # Compact sorted UTF-8 vocabulary: no large object trie in a 128MB Worker.
    ordered=sorted((word.encode('utf-8'),i,float(score)) for i,(word,score) in enumerate(vocab) if i>1)
    offsets=[0]; blob=bytearray(); ids=[]; scores=[]
    for word,i,s in ordered:
        blob.extend(word);offsets.append(len(blob));ids.append(i);scores.append(s)
    save('vocab.bin.gz',struct.pack('<II',len(ids),max(len(x[0]) for x in ordered))+np.array(offsets,dtype='<u4').tobytes()+np.array(ids,dtype='<u4').tobytes()+np.array(scores,dtype='<f4').tobytes()+blob)
    del ordered,blob,offsets,ids,scores
    # All token weights remain available, including terms absent from the corpus.
    for start in range(0,len(q),2048):
        part=q[start:start+2048]; scale=scales[start:start+2048]
        save(f'tokens-{start//2048}.bin.gz',struct.pack('<II',start,len(part))+scale.tobytes()+part.tobytes())
    catalog=json.loads((ROOT/'snapshot/catalog.json').read_text('utf-8'))
    docs={d['id']:d for d in catalog['documents']}
    used=set(); vectors=[]; locations=[]; unique={}; page_count=0; char_count=0
    page_map=[]; page_meta=[]; doc_ids=list(docs); doc_index={d:i for i,d in enumerate(doc_ids)}
    for shard in catalog['shards']:
        texts=json.loads(gzip.decompress((ROOT/f'snapshot/corpus/text-{shard["id"]}.json.gz').read_bytes()))
        pages=json.loads(gzip.decompress((ROOT/f'snapshot/corpus/pages-{shard["id"]}.json.gz').read_bytes()))['pages']
        for pi,(text,p) in enumerate(zip(texts,pages)):
            gid=shard['offset']+pi; assert gid==len(page_map)
            page_map.append(doc_index[p[0]]); page_meta.append([p[0],p[1]])
            # Do not deduplicate across years/documents; filters must remain exact.
            part=list(chunks(text)); encs=tok.encode_batch([norm(x[2]) for x in part],add_special_tokens=False)
            for (start,end,_),enc in zip(part,encs):
                token_ids=[i for i in enc.ids if i>1];used.update(token_ids)
                if token_ids:v=normalize(weights[token_ids].mean(axis=0))
                else:v=np.zeros(DIM,dtype='f4')
                vectors.append(v);locations.append((gid,start,end))
            page_count+=1;char_count+=len(text)
        print(json.dumps({'shard':shard['id'],'pages':page_count,'chunks':len(vectors),'seconds':round(time.time()-begin)}),flush=True)
    matrix=np.asarray(vectors,dtype='f4');del vectors
    np.save(ROOT/'work/semantic-vectors.npy',matrix)
    np.save(ROOT/'work/semantic-locations.npy',np.asarray(locations,dtype='u4'))
    save('page-docs.bin.gz',np.asarray(page_map,dtype='<u2').tobytes())
    # Corpus token cache avoids fetching hundreds of random token blocks at rerank.
    common=np.array(sorted(used),dtype='<u4')
    save('common.bin.gz',struct.pack('<I',len(common))+common.tobytes()+scales[common].tobytes()+q[common].tobytes())
    (ROOT/'work/semantic-build.json').write_text(json.dumps({'pages':page_count,'chunks':len(matrix),'characters':char_count,'used_tokens':len(used),'doc_ids':doc_ids,'quantization_mean_cosine':float(cos.mean()),'quantization_min_cosine':float(cos.min()),'tokenizer_vocab':len(vocab)},ensure_ascii=False),'utf-8')
    # Known tokenization and embedding parity fixtures, including Korean variants.
    queries=['노인일자리','어르신이 일할 수 있도록 돕는 사업','아이를 맡기는 시설 지원','도서관','청년 주거비 지원','2026년 본예산 장애인 이동 지원','３，０００천원\n성남시','e-government 성남 2025','𠮷 독거노인 돌봄','거동이 불편한 주민의 교통편','출산한 가정에 주는 지원금','주민이 책을 빌려 읽을 수 있는 곳']
    fixtures=[]
    for query in queries:
        ids=[i for i in tok.encode(norm(query),add_special_tokens=False).ids if i>1]
        fixtures.append({'text':query,'ids':ids,'vector':normalize(weights[ids].mean(axis=0)).tolist()})
    (ROOT/'tests/embedding-fixtures.json').write_text(json.dumps(fixtures,ensure_ascii=False),'utf-8')
    print(json.dumps({'embedding_complete':True,'pages':page_count,'chunks':len(matrix),'used_tokens':len(used),'seconds':round(time.time()-begin)}),flush=True)

if __name__=='__main__':run()
