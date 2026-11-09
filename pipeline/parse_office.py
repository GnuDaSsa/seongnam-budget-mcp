"""Text blocks for non-PDF sources. Never invent PDF page numbers."""
import argparse, io, json, re, sys, zipfile, tempfile
from pathlib import Path
from xml.etree import ElementTree as ET
from collect import DATA, ROOT, db, digest, now, extract_unit

vendor=ROOT.parent/'python-libs'
if vendor.exists(): sys.path.insert(0,str(vendor))

class PartialBlocks(list):
    def __init__(self, blocks, issues):
        super().__init__(blocks);self.issues=issues

def paragraphs_to_blocks(paragraphs,section):
    out=[];buf=[];start=1
    for i,t in enumerate(paragraphs,1):
        if len('\n'.join(buf))+len(t)>2000 and buf:
            out.append((f'{section}; 문단 {start}–{i-1}', '\n'.join(buf)));buf=[];start=i
        if t.strip():buf.append(t.strip())
    if buf:out.append((f'{section}; 문단 {start}–{len(paragraphs)}','\n'.join(buf)))
    return out

def parse(path,ext):
    blocks=[]
    if ext=='zip':
        base=ROOT/'work'/'archive-parse';base.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(path) as z, tempfile.TemporaryDirectory(dir=base) as folder:
            members=[x for x in z.infolist() if not x.is_dir()]
            if len(members)>1000 or sum(x.file_size for x in members)>200_000_000:raise ValueError('Office archive expansion limit')
            unsupported=[]
            for i,member in enumerate(members):
                fmt=member.filename.rsplit('.',1)[-1].lower()
                if fmt not in ['hwp','hwpx','xls','xlsx']:
                    unsupported.append(member.filename);continue
                # Never use the archive member's path as a local path.
                temporary=Path(folder)/f'member-{i}.{fmt}';temporary.write_bytes(z.read(member))
                name=member.filename
                if not member.flag_bits&0x800:
                    try:name=name.encode('cp437').decode('cp949')
                    except (UnicodeError,LookupError):pass
                try:blocks += [(f'ZIP 내부 {name}; {location}',text) for location,text in parse(temporary,fmt)]
                except Exception as e:unsupported.append(name+': '+str(e)[:120])
            if unsupported:return PartialBlocks(blocks,unsupported)
    elif ext=='hwp':
        with path.open('rb') as f:
            if f.read(30).startswith(b'HWP Document File V3'):raise ValueError('HWP 3.x 미지원: 원문 변환 필요')
        from hwp5.xmlmodel import Hwp5File
        from hwp5.hwp5txt import TextTransform
        dest=io.BytesIO();h=Hwp5File(str(path))
        try:TextTransform().transform_hwp5_to_text(h,dest)
        finally:h.close()
        blocks=paragraphs_to_blocks(dest.getvalue().decode('utf-8').splitlines(),'HWP 추출 본문; 인쇄 쪽수 미확인')
    elif ext=='hwpx':
        with zipfile.ZipFile(path) as z:
            members=sorted(n for n in z.namelist() if re.fullmatch(r'Contents/section\d+\.xml',n))
            if sum(z.getinfo(n).file_size for n in members)>200_000_000:raise ValueError('HWPX expansion limit')
            for member in members:
                root=ET.fromstring(z.read(member));paragraphs=[]
                # A table cell can contain nested paragraphs. Flush each text node
                # once in document order rather than counting parent and child twice.
                buf=[]
                def visit(node):
                    if node.tag.rsplit('}',1)[-1]=='t' and node.text:buf.append(node.text)
                    for child in node:visit(child)
                    if node.tag.rsplit('}',1)[-1]=='p' and buf:
                        paragraphs.append(''.join(buf));buf.clear()
                visit(root)
                if buf:paragraphs.append(''.join(buf))
                blocks+=paragraphs_to_blocks(paragraphs,member)
    elif ext=='xlsx':
        from openpyxl import load_workbook
        from openpyxl.utils import get_column_letter
        wb=load_workbook(path,read_only=True,data_only=False,keep_links=False)
        try:
            for sheet in wb:
                if sheet.max_row>200000 or sheet.max_column>200:raise ValueError('Workbook dimension exceeds ingestion limit')
                lines=[];first=1
                for ri,row in enumerate(sheet.iter_rows(values_only=True),1):
                    line=' | '.join(f'{get_column_letter(ci)}{ri}={v}' for ci,v in enumerate(row,1) if v is not None)
                    if line:lines.append(line)
                    if len('\n'.join(lines))>=2000:
                        blocks.append((f'시트 {sheet.title}; 행 {first}–{ri}', '\n'.join(lines)));lines=[];first=ri+1
                if lines:blocks.append((f'시트 {sheet.title}; 행 {first}–{sheet.max_row}','\n'.join(lines)))
        finally:wb.close()
    elif ext=='xls':
        import xlrd
        from openpyxl.utils import get_column_letter
        wb=xlrd.open_workbook(str(path),on_demand=True)
        try:
            for sheet in wb.sheets():
                if sheet.nrows>200000 or sheet.ncols>200:raise ValueError('Workbook dimension exceeds ingestion limit')
                lines=[];first=1
                for ri in range(sheet.nrows):
                    vals=[]
                    for ci,v in enumerate(sheet.row_values(ri),1):
                        if v=='':continue
                        if isinstance(v,float) and v.is_integer():v=int(v)
                        vals.append(f'{get_column_letter(ci)}{ri+1}={v}')
                    if vals:lines.append(' | '.join(vals))
                    if len('\n'.join(lines))>=2000:
                        blocks.append((f'시트 {sheet.name}; 행 {first}–{ri+1}; 저장된 계산값', '\n'.join(lines)));lines=[];first=ri+2
                if lines:blocks.append((f'시트 {sheet.name}; 행 {first}–{sheet.nrows}; 저장된 계산값','\n'.join(lines)))
        finally:wb.release_resources()
    else:raise ValueError('Unsupported office format: '+ext)
    return blocks

def run(reparse_format=None):
    c=db();docs=c.execute("SELECT metadata FROM documents WHERE status IN ('unsupported_format','indexed_text','partial_text')" if reparse_format else "SELECT metadata FROM documents WHERE status='unsupported_format'").fetchall();c.close()
    for (meta,) in docs:
        m=json.loads(meta);ext=m['filename'].rsplit('.',1)[-1].lower()
        if ext not in ['hwp','hwpx','xlsx','xls','zip']:continue
        if reparse_format and ext!=reparse_format:continue
        path=DATA/'raw'/(m['id']+'_'+m['filename'])
        try:
            blocks=parse(path,ext)
            if not blocks:raise ValueError('No text extracted')
            rows=[]
            for i,(location,text) in enumerate(blocks,1):
                text=f'[원문 위치: {location}; PDF 페이지 번호 아님]\n'+text
                unit=extract_unit(text)
                rows.append((f'{m["id"]}:p{i}',m['id'],i,text,digest(text.encode()),unit,None))
            issues=getattr(blocks,'issues',[])
            m.update({'locator_kind':'text_block','indexed_units':len(rows),'format':ext,'extraction_warnings':issues,'extraction_note':'문단 또는 시트/행 기준. 인쇄 쪽수는 미확인. 표 열과 원문 수치는 원본으로 검증.'})
            c=db();c.execute('DELETE FROM pages WHERE document_id=?',(m['id'],));c.executemany('INSERT INTO pages VALUES(?,?,?,?,?,?,?)',rows)
            c.execute("UPDATE documents SET metadata=?,status=?,error=? WHERE id=?",(json.dumps(m,ensure_ascii=False),'partial_text' if issues else 'indexed_text',f'{len(issues)}개 내부 파일 미처리; extraction_warnings 확인' if issues else None,m['id']));c.commit();c.close()
            print(json.dumps({'id':m['id'],'format':ext,'blocks':len(rows),'unprocessed_members':len(issues)},ensure_ascii=False),flush=True)
        except Exception as e:
            c=db();c.execute('UPDATE documents SET error=? WHERE id=?',(str(e)[:400],m['id']));c.commit();c.close();print(json.dumps({'id':m['id'],'error':str(e)[:200]},ensure_ascii=False),flush=True)

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--reparse-format',choices=['hwp','hwpx','xlsx','xls','zip']);run(a.parse_args().reparse_format)
