"""Train deterministic IVF cosine index; keep all chunks and filterable locations."""
import json,struct,time,hashlib
from build_vectors import ROOT,OUT,MODEL,REV,DIM,save,normalize,quantize,np
from sklearn.cluster import MiniBatchKMeans
from threadpoolctl import threadpool_limits

def run():
    begin=time.time(); v=np.load(ROOT/'work/semantic-vectors.npy',mmap_mode='r'); loc=np.load(ROOT/'work/semantic-locations.npy')
    report=json.loads((ROOT/'work/semantic-build.json').read_text('utf-8'))
    rng=np.random.default_rng(42); sample=v[rng.choice(len(v),min(60000,len(v)),replace=False)]
    with threadpool_limits(limits=4):
        km=MiniBatchKMeans(n_clusters=256,random_state=42,n_init=1,batch_size=2048,max_iter=80,reassignment_ratio=0.01)
        km.fit(sample)
        centers=normalize(km.cluster_centers_).astype('<f4')
        assignment=np.empty(len(v),dtype='u2')
        for start in range(0,len(v),4096):assignment[start:start+4096]=(v[start:start+4096]@centers.T).argmax(axis=1)
    sizes=[]
    for i in range(len(centers)):
        take=np.flatnonzero(assignment==i); part=v[take]; q,scale=quantize(part)
        # Cosine = dot(query, int8 row) / int8 row norm; scale cancels.
        norms=np.linalg.norm(q.astype('f4'),axis=1).astype('<f4')
        save(f'cluster-{i}.bin.gz',struct.pack('<I',len(take))+loc[take].astype('<u4').tobytes()+norms.tobytes()+q.tobytes())
        sizes.append(len(take))
    save('centroids.bin.gz',centers.tobytes())
    manifest={'model':MODEL,'model_revision':REV,'dimensions':DIM,'embedding_type':'BGE-M3-distilled static token embeddings; mean pooling + L2','quantization':'symmetric int8 per token and chunk; float32 scales','normalization':'Tokenizers.js 0.2.0 Precompiled-compatible NFKC; matched offline/online','tokenizer_unknown_score':-23.517933250454895,'chunk_characters':800,'chunk_overlap':120,'offset_unit':'Unicode code points','index_type':'cosine IVF256','nprobe':24,'clusters':sizes,'reranker':'potion-token-maxsim-v1','reranker_type':'static token late interaction, not a cross-encoder','rerank_candidates':32,'rrf_k':60,**report,'generated_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'model_url':'https://huggingface.co/'+MODEL,'license':'MIT'}
    manifest['source_files']=[{'file':name,'sha256':hashlib.sha256((ROOT/'work/models/potion'/name).read_bytes()).hexdigest()} for name in ['model.safetensors','tokenizer.json','config.json']]
    manifest['corpus_catalog_sha256']=hashlib.sha256((ROOT/'snapshot/catalog.json').read_bytes()).hexdigest()
    manifest['assets_bytes']=sum(p.stat().st_size for p in OUT.glob('*.gz'))
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n','utf-8')
    print(json.dumps({'index_complete':True,'chunks':len(v),'clusters':len(centers),'largest_cluster':max(sizes),'assets_bytes':manifest['assets_bytes'],'seconds':round(time.time()-begin)}),flush=True)
if __name__=='__main__':run()
