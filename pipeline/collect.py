"""Official public budget collector. Windows curl uses OS TLS; no TLS bypass.
python pipeline/collect.py --discover / --collect / --export
Raw downloads and SQLite remain outside the published source snapshot.
"""
import argparse, concurrent.futures, hashlib, io, json, os, re, sqlite3, subprocess, time, zipfile, threading
from pathlib import Path
from urllib.parse import urljoin, urlparse
from datetime import datetime, timezone
from bs4 import BeautifulSoup
import fitz

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
BASE = 'https://www.seongnam.go.kr'
INDEX = BASE + '/cn03050201'
UA = 'SeongnamBudgetResearch/0.1 (public budget archive; low concurrency)'
DATA.mkdir(exist_ok=True)
PDF_LOCK = threading.Lock()

def now(): return datetime.now(timezone.utc).isoformat()
def digest(x): return hashlib.sha256(x).hexdigest()
def fetch(url, path):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname != 'www.seongnam.go.kr':
        raise ValueError('Only the official HTTPS host is allowed')
    if any(parsed.path.startswith(x) for x in ['/media/','/fnct/','/resve/','/ajax/','/comm/','/metadata/','/api/','/popup/','/webeditor/','/anyid/','/include/','/organ/','/WEB-INF/']):
        raise ValueError('Path disallowed by source robots.txt')
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.part')
    # No redirect following: a changed host or endpoint must be reviewed.
    cmd = ['curl.exe' if os.name == 'nt' else 'curl', '--fail', '--silent', '--show-error',
           '--proto', '=https', '--max-time', '300', '--max-filesize', '1000000000',
           '--retry', '2', '--retry-delay', '2', '-A', UA, url, '-o', str(temp)]
    subprocess.run(cmd, check=True, capture_output=True, timeout=920)
    temp.replace(path)

def db():
    c=sqlite3.connect(DATA/'budget.sqlite', timeout=60)
    c.execute('PRAGMA journal_mode=WAL')
    c.executescript('''
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, url TEXT UNIQUE NOT NULL, metadata TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'discovered', sha256 TEXT, bytes INTEGER,
      page_count INTEGER DEFAULT 0, indexed_pages INTEGER DEFAULT 0,
      fetched_at TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, page INTEGER NOT NULL,
      text TEXT NOT NULL, text_hash TEXT NOT NULL, unit TEXT, printed_page TEXT,
      UNIQUE(document_id,page));
    CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(text, content='pages', content_rowid='rowid', tokenize='trigram');
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, kind TEXT, details TEXT);
    ''')
    return c

def clean(t): return re.sub(r'\s+', ' ', t).strip()

def extract_unit(text):
    """The budget heading '단위: 사업명' is not a monetary unit."""
    units=[]
    for label in re.findall(r'단위\s*[:：]\s*([^\n)\]]{1,50})',text):
        for value in re.findall(r'(?<![가-힣])(?:백\s*만\s*원|천\s*원|억\s*원|원)(?![가-힣])',label):
            unit=re.sub(r'\s','',value)
            if unit not in units:units.append(unit)
    return ' / '.join(units) if units else None

def upsert_metadata(c, m):
    """Rediscovery updates source fields without dropping extraction provenance."""
    old=c.execute('SELECT metadata FROM documents WHERE url=?',(m['url'],)).fetchone()
    merged=(json.loads(old[0]) if old else {}) | m
    c.execute('INSERT INTO documents(id,url,metadata) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET metadata=excluded.metadata',
              (m['id'],m['url'],json.dumps(merged,ensure_ascii=False)))

def discover(cached=False):
    index=DATA/'source-index.html'
    if not cached or not index.exists():fetch(INDEX,index)
    soup=BeautifulSoup(index.read_bytes(),'html.parser')
    result={}
    for section in soup.select('div[data-year]'):
        heading=account=kind=''
        for e in section.find_all(['h4','h5','h6','a']):
            if e.name=='h4': heading=clean(e.get_text(' ')); account=kind=''; continue
            if e.name=='h5': account=clean(e.get_text(' ')); kind=''; continue
            if e.name=='h6': kind=clean(e.get_text(' ')); continue
            onclick=e.get('onclick','')
            m=re.search(r"fileDownload\('([^']+)'\s*,\s*'([^']+)'",onclick)
            href=e.get('href','')
            if m and m[1].startswith('/'): href=m[1]+m[2]
            elif not re.search(r'\.(pdf|zip|hwp|hwpx|xlsx?)($|\?)',href,re.I): continue
            year=re.search(r'(20\d{2}|19\d{2})년',heading)
            # Mirror official portal-common.js link migration, not guessed paths.
            if year and e.find_parent(class_=re.compile(r'^bgt-pdf2?$')):
                href='/humanframe/file/sncity/bgt/'+year[1]+'/'+href.split('/')[-1]
            url=urljoin(BASE,href)
            if urlparse(url).hostname!='www.seongnam.go.kr': continue
            container=e.find_parent('td') or e.find_parent('tr') or e.find_parent('li') or e.parent
            title=clean(container.get_text(' '))
            title=re.sub(r'(바로보기|다운로드|파일열기)', '',title).strip()
            parent_li=e.find_parent('li')
            old_label=parent_li.find('strong',recursive=False) if parent_li else None
            old_label=clean(old_label.get_text(' ')) if old_label else ''
            if e.find_parent('tr'):
                row=e.find_parent('tr')
                header=row.find('th')
                if not header:
                    prev=row.find_previous_sibling('tr')
                    while prev and not header:
                        header=prev.find('th');prev=prev.find_previous_sibling('tr')
                kind=clean(header.get_text(' ')) if header else ''
                account=next((x for x in ['상수도공기업특별회계','하수도공기업특별회계','공영개발사업특별회계','기타특별회계','일반회계'] if x in title),'원문 확인')
            # Older tables put revision labels in first-column headers.
            context=' '.join([heading, old_label, account, kind, title])
            revision=re.search(r'(\d+)\s*(?:회|차)\s*추[가경]|추경\s*(\d+)',context)
            budget_type='추경' if any(t in context for t in ['추경','추가경정']) else '본예산'
            meta={'id':digest(url.encode())[:20],'url':url,'source_page':INDEX,
                  'title':clean(' · '.join(dict.fromkeys(x for x in [heading,old_label,account,kind,title] if x))),
                  'year':int(year[1]) if year else None, 'budget_type':budget_type,
                  'revision':int(revision[1] or revision[2]) if revision else None,
                  'account':account if '회계' in account else '원문 확인','source_section':account,'category':'연도별 예산서',
                  'filename':urlparse(url).path.split('/')[-1], 'discovered_at':now()}
            if url not in result: result[url]=meta
    c=db()
    c.execute("DELETE FROM documents WHERE url LIKE 'https://www.seongnam.go.kr/contents/down/%' AND indexed_pages=0")
    for m in result.values():
        upsert_metadata(c,m)
    c.execute('INSERT INTO runs VALUES(?,?,?)',(now(),'discovery',json.dumps({'source':INDEX,'count':len(result)})))
    c.commit(); c.close()
    print(json.dumps({'discovered':len(result),'years':sorted(set(m['year'] for m in result.values() if m['year']))}),flush=True)

def parse_pdf(raw, identifier):
    # PyMuPDF must not be used concurrently in multiple threads.
    with PDF_LOCK: return _parse_pdf(raw, identifier)

def _parse_pdf(raw, identifier):
    out=[]
    doc=fitz.open(filename=str(raw)) if isinstance(raw,Path) else fitz.open(stream=raw,filetype='pdf')
    for idx,p in enumerate(doc):
        text=p.get_text('text',sort=True).replace('\x00','')
        text='\n'.join(line.rstrip() for line in text.splitlines()).strip()
        unit=extract_unit(text)
        page_match=re.findall(r'(?:^|\n)\s*[-－]\s*(\d+)\s*[-－]\s*(?:$|\n)',text)
        if len(re.sub(r'\s','',text))>=30:
            out.append((f'{identifier}:p{idx+1}',identifier,idx+1,text,digest(text.encode()),unit,page_match[-1] if page_match else None))
    return len(doc),out

def collect_one(m):
    path=DATA/'raw'/m['filename']
    path=path.with_name(m['id']+'_'+path.name)
    try:
        if not path.exists(): fetch(m['url'],path)
        hasher=hashlib.sha256()
        with path.open('rb') as f:
            header=f.read(16);f.seek(0)
            while block:=f.read(1024*1024):hasher.update(block)
        sha=hasher.hexdigest()
        pages=[]; count=0
        if header.startswith(b'%PDF'):
            count,pages=parse_pdf(path,m['id'])
            status='indexed' if len(pages)==count else 'partial_ocr_required'
        elif zipfile.is_zipfile(path) and m['filename'].lower().endswith('.zip'):
            # Archive members are never extracted to filesystem paths.
            with zipfile.ZipFile(path) as z:
                members=[x for x in z.infolist() if x.filename.lower().endswith('.pdf')]
                if sum(x.file_size for x in members)>1_000_000_000: raise ValueError('Archive expansion limit')
                for part,x in enumerate(members):
                    n,pp=parse_pdf(z.read(x),m['id']+':zip'+str(part))
                    # Keep member citation in page text and use virtual sequential PDF page.
                    for row in pp:
                        pages.append((f'{m["id"]}:p{count+row[2]}',m['id'],count+row[2],f'[ZIP 내부 파일: {x.filename}; PDF 페이지: {row[2]}]\n'+row[3],row[4],row[5],row[6]))
                    count+=n
            status='indexed_archive' if pages else 'unsupported_format'
        else: status='unsupported_format'
        c=db()
        c.execute('DELETE FROM pages WHERE document_id=?',(m['id'],))
        c.executemany('INSERT INTO pages VALUES(?,?,?,?,?,?,?)',pages)
        c.execute('UPDATE documents SET status=?,sha256=?,bytes=?,page_count=?,indexed_pages=?,fetched_at=?,error=NULL WHERE id=?',
                  (status,sha,path.stat().st_size,count,len(pages),now(),m['id']))
        c.commit(); c.close()
        return m['id'],status,count
    except Exception as e:
        error=str(e)[:500]
        if isinstance(e,subprocess.CalledProcessError): error=(e.stderr or b'').decode(errors='replace')[:500]
        c=db(); c.execute('UPDATE documents SET status=?,error=? WHERE id=?',('failed',error,m['id'])); c.commit(); c.close()
        return m['id'],'failed',error

def collect(workers, related=False, failed_only=False):
    c=db(); rows=c.execute("SELECT metadata FROM documents WHERE "+("status='failed'" if failed_only else "status IN ('discovered','failed')") + (" AND json_extract(metadata,'$.category')!='연도별 예산서'" if related else '') + " ORDER BY json_extract(metadata,'$.year') DESC").fetchall(); c.close()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for i,res in enumerate(pool.map(collect_one,[json.loads(x[0]) for x in rows])):
            if i%10==0 or res[1]=='failed': print(json.dumps({'processed':i+1,'total':len(rows),'result':res},ensure_ascii=False),flush=True)
    c=db(); c.execute("INSERT INTO page_fts(page_fts) VALUES('rebuild')"); c.commit(); c.close()
    export()

def export():
    c=db(); c.row_factory=sqlite3.Row
    docs=[]
    for r in c.execute('SELECT * FROM documents'):
        m=json.loads(r['metadata']); m.update({k:r[k] for k in ['status','sha256','bytes','page_count','indexed_pages','fetched_at','error']}); docs.append(m)
    summary={'generated_at':now(),'source':INDEX,'scope':'연도별 예산서 전체 메뉴 및 성과계획·기금·중기재정·투자심사·결산 게시판의 공개 첨부',
             'whole_city_coverage_complete':False,'documents':len(docs),'indexed_documents':sum(d['indexed_pages']>0 or d.get('indexed_units',0)>0 for d in docs),
             'downloaded_documents':sum(bool(d['sha256']) for d in docs),
             'indexed_text_blocks':sum(d.get('indexed_units',0) for d in docs),
             'unindexed_pdf_pages':sum(d['page_count']-d['indexed_pages'] for d in docs),
             'page_extraction_note':'30자 미만 페이지는 색인에서 제외. 빈 페이지와 스캔/OCR 필요 페이지가 함께 포함되며 OCR을 수행했다는 뜻이 아님.',
             'pdf_pages':sum(d['page_count'] for d in docs),'indexed_pages':sum(d['indexed_pages'] for d in docs),
             'status_counts':dict(c.execute('SELECT status,count(*) FROM documents GROUP BY status').fetchall()),
             'years':sorted(set(d['year'] for d in docs if d['year']),reverse=True),
             'additional_sources':[{'category':'중기지방재정','url':BASE+'/cn03050202','status':'discovered_not_indexed'},
               {'category':'성과계획서','url':BASE+'/bbs03050204','status':'discovered_not_indexed'},
               {'category':'기금운용현황','url':BASE+'/bbs030506','status':'discovered_not_indexed'},
               {'category':'예산기준 재정공시','url':BASE+'/pm03050101','status':'discovered_not_indexed'},
               {'category':'결산현황','url':BASE+'/bbs030503','status':'discovered_not_indexed'}]}
    summary['category_stats']={category:{'discovered':len(group),'downloaded':sum(bool(d['sha256']) for d in group),'indexed_documents':sum(d['indexed_pages']>0 or d.get('indexed_units',0)>0 for d in group)} for category in sorted({d['category'] for d in docs}) for group in [[d for d in docs if d['category']==category]]}
    if (DATA/'source-audit.json').exists():summary['additional_sources']=json.loads((DATA/'source-audit.json').read_text(encoding='utf-8'))
    (DATA/'catalog.json').write_text(json.dumps({'summary':summary,'documents':docs},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False),flush=True)

if __name__=='__main__':
    a=argparse.ArgumentParser(); a.add_argument('--discover',action='store_true'); a.add_argument('--cached',action='store_true'); a.add_argument('--collect',action='store_true'); a.add_argument('--export',action='store_true'); a.add_argument('--related-only',action='store_true'); a.add_argument('--failed-only',action='store_true'); a.add_argument('--workers',type=int,default=2); args=a.parse_args()
    if args.discover: discover(args.cached)
    if args.collect: collect(max(1,min(args.workers,3)),args.related_only,args.failed_only)
    if args.export: export()
