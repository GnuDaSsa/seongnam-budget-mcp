"""Compare IVF with exhaustive cosine retrieval on real Korean query embeddings."""
import gzip,json,time
from build_vectors import ROOT,OUT,np
from threadpoolctl import threadpool_limits
v=np.load(ROOT/'work/semantic-vectors.npy',mmap_mode='r')
loc=np.load(ROOT/'work/semantic-locations.npy')
m=json.loads((OUT/'manifest.json').read_text('utf-8'))
centers=np.frombuffer(gzip.decompress((OUT/'centroids.bin.gz').read_bytes()),dtype='<f4').reshape(-1,256)
fixtures=json.loads((ROOT/'tests/embedding-fixtures.json').read_text('utf-8'))
report=[]
with threadpool_limits(limits=4):
    assignments=np.empty(len(v),dtype='u2')
    for i in range(0,len(v),4096):assignments[i:i+4096]=(v[i:i+4096]@centers.T).argmax(axis=1)
    for f in fixtures:
        if f['text'].startswith(('３','𠮷','e-government')):continue
        q=np.asarray(f['vector'],dtype='f4');scores=v@q
        top=np.argsort(-scores)[:20]
        probes=np.argsort(-(centers@q))[:m['nprobe']]
        inside=np.isin(assignments[top],probes)
        report.append({'query':f['text'],'recall_at_20':float(inside.mean()),'best_cosine':float(scores[top[0]])})
result={'kind':'IVF candidate recall vs exhaustive cosine (not relevance quality)','queries':report,'mean_recall_at_20':sum(r['recall_at_20'] for r in report)/len(report),'nprobe':m['nprobe']}
(ROOT/'docs/ann-evaluation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),'utf-8')
print(json.dumps(result,ensure_ascii=False))
