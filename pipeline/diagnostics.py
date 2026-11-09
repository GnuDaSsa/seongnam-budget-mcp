import json, sqlite3, importlib.metadata
from pathlib import Path
from collect import DATA
c=sqlite3.connect(DATA/'budget.sqlite')
print(json.dumps({'states':c.execute('SELECT status,count(*),sum(page_count),sum(indexed_pages),round(sum(bytes)/1e6) FROM documents GROUP BY status').fetchall(),
 'unsupported':[(json.loads(m)['title'],b) for m,b in c.execute("SELECT metadata,bytes FROM documents WHERE status='unsupported_format'")],
 'failed':[(json.loads(m)['title'],e) for m,e in c.execute("SELECT metadata,error FROM documents WHERE status='failed'")],
 'versions':{p:importlib.metadata.version(p) for p in ['beautifulsoup4','PyMuPDF']}},ensure_ascii=False))
