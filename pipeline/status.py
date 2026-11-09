"""Compact live ingestion diagnostics. Read only; safe while collectors run."""
import json, shutil
from collect import db, DATA
c=db()
print(json.dumps({
    'status':dict(c.execute('SELECT status,count(*) FROM documents GROUP BY status')),
    'pdf_pages':c.execute('SELECT sum(page_count),sum(indexed_pages) FROM documents').fetchone(),
    'text_blocks':c.execute("SELECT sum(json_extract(metadata,'$.indexed_units')) FROM documents").fetchone()[0],
    'bytes':c.execute('SELECT sum(bytes) FROM documents').fetchone()[0],
    'free_gb':round(shutil.disk_usage(DATA).free/1e9,2),
    'failed':[{'id':r[0],'title':json.loads(r[1])['title'],'error':r[2]} for r in c.execute("SELECT id,metadata,error FROM documents WHERE status='failed'")],
    'unsupported':[{'id':r[0],'file':json.loads(r[1])['filename'],'error':r[2]} for r in c.execute("SELECT id,metadata,error FROM documents WHERE status='unsupported_format'")],
    'pending_by_year':dict(c.execute("SELECT json_extract(metadata,'$.year'),count(*) FROM documents WHERE status='discovered' GROUP BY 1 ORDER BY 1 DESC"))
},ensure_ascii=False,indent=2))
c.close()
