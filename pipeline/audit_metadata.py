"""Repair a known section/account conflation and emit a reproducible audit."""
import json
from collect import db, DATA, now
c=db();changes=0
for identifier,raw in c.execute('SELECT id,metadata FROM documents').fetchall():
    m=json.loads(raw)
    if m['category']=='연도별 예산서' and m.get('account') not in ['',None,'원문 확인'] and '회계' not in m['account']:
        m['source_section']=m['account'];m['account']='원문 확인'
        c.execute('UPDATE documents SET metadata=? WHERE id=?',(json.dumps(m,ensure_ascii=False),identifier));changes+=1
c.commit()
annual=[json.loads(r[0]) for r in c.execute("SELECT metadata FROM documents WHERE json_extract(metadata,'$.category')='연도별 예산서'")]
checks={
    'annual_urls_unique':len({m['url'] for m in annual})==len(annual),
    'annual_years_2007_2026':sorted({m['year'] for m in annual})==list(range(2007,2027)),
    'official_https_urls':all(m['url'].startswith('https://www.seongnam.go.kr/') for m in annual),
    'legacy_2019_revision_1':all(m['budget_type']=='추경' and m['revision']==1 for m in annual if m['filename']=='11046_13.pdf'),
    'no_non_account_labels':all('회계' in m['account'] or m['account']=='원문 확인' for m in annual)
}
report={'at':now(),'account_labels_corrected':changes,'annual_documents':len(annual),'checks':checks}
(DATA/'metadata-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False));c.close()
if not all(checks.values()):raise SystemExit(1)
