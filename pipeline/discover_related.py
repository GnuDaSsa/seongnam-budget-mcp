"""Enumerate all pages of related official financial boards; record policy exclusions."""
import argparse, json, re
from urllib.parse import urlencode
from collect import BASE, DATA, fetch, db, digest, now, clean, BeautifulSoup, upsert_metadata

BOARDS={'bbs03050204':'성과계획서','bbs030506':'기금운용현황','bbs030503':'결산현황','bbs03050203':'투자심사'}

def add(meta):
    c=db(); upsert_metadata(c,meta); c.commit(); c.close()

def run(cached=False):
    audit=[]
    for board,category in BOARDS.items():
        visited=set(); page=1; posts=set(); count=0
        while page<=100:
            url=BASE+'/'+board+'?curPage='+str(page)
            cache=DATA/'html'/f'{board}-{page}.html'
            if not cached or not cache.exists(): fetch(url,cache)
            s=BeautifulSoup(cache.read_bytes(),'html.parser')
            bbs=s.select_one('input[name=bbsCrtSn]')['value']
            rows=s.select('tbody tr'); fresh=0
            for row in rows:
                ids=re.findall(r'fn_atch_detail\((\d+)',str(row))
                if not ids: ids=re.findall(r"fn_move_form\(['\"]?(\d+)",str(row))
                if not ids: continue
                post=ids[0]
                if post in posts: continue
                fresh+=1; posts.add(post)
                title=clean(row.get_text(' ')); title=re.sub(r'^(번호)?\s*\d+\s*제목\s*','',title)
                cache_files=DATA/'html'/f'{board}-{post}.json'
                if not cached or not cache_files.exists(): fetch(BASE+'/'+board+'/atchFileDetail?pstSn='+post,cache_files)
                files=json.loads(cache_files.read_text(encoding='utf-8')).get('atchFileVO',[])
                for f in files:
                    filename=f.get('orginlFileNm','')
                    if not re.search(r'\.(pdf|zip|hwp|hwpx|xlsx?)$',filename,re.I): continue
                    file_url=BASE+'/'+board+'/getFile?'+urlencode({'bbsCrtSn':bbs,'pstSn':post,'fileNo':f['fileNo']})
                    year=re.search(r'(20\d{2}|19\d{2})',filename+' '+title)
                    rev=re.search(r'(\d+)\s*(?:회|차)\s*추',title)
                    meta={'id':digest(file_url.encode())[:20],'url':file_url,'source_page':url,'title':filename,
                          'year':int(year[1]) if year else None,'budget_type':'결산' if category=='결산현황' else ('추경' if '추경' in title else ('본예산' if category=='성과계획서' else '관련계획')),
                          'revision':int(rev[1]) if rev else None,'account':'원문 확인','category':category,
                          'filename':digest(file_url.encode())[:12]+'.'+filename.rsplit('.',1)[-1], 'original_filename':filename,'discovered_at':now()}
                    add(meta); count+=1
            links=[int(m[1]) for a in s.select('a[href]') if (m:=re.search(r'curPage=(\d+)',a['href']))]
            if fresh==0 or not links or max(links)<=page: break
            page+=1
        audit.append({'category':category,'url':BASE+'/'+board,'pages_crawled':page,'posts':len(posts),'files':count,'status':'enumerated'})
        print(json.dumps(audit[-1],ensure_ascii=False),flush=True)
    url=BASE+'/humanframe/file/10102_1.pdf'
    add({'id':digest(url.encode())[:20],'url':url,'source_page':BASE+'/cn03050202','title':'중기지방재정계획 (공개 연결 원문)',
         'year':None,'budget_type':'관련계획','revision':None,'account':'원문 확인','category':'중기지방재정',
         'filename':'10102_1.pdf','discovered_at':now()})
    audit.append({'category':'중기지방재정','url':BASE+'/cn03050202','files':1,'status':'enumerated'})
    audit.append({'category':'예산기준·결산기준 재정공시','url':BASE+'/pm03050101','status':'robots_excluded_downloads','reason':'공식 다운로드가 robots.txt Disallow /fnct/ 경로에 있어 자동수집 제외; 파일 제공 또는 허용 경로 필요'})
    (DATA/'source-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--cached',action='store_true');run(a.parse_args().cached)
