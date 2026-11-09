"""Regressions for data provenance and table duplication, using no network."""
import sys, sqlite3, json, tempfile, unittest, zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'pipeline'))
from collect import upsert_metadata, _parse_pdf, extract_unit
from parse_office import parse
from defusedxml.common import DTDForbidden
import fitz

class PipelineTests(unittest.TestCase):
    def test_budget_program_heading_is_not_a_currency_unit(self):
        self.assertEqual(extract_unit('단위: 주민생활지원시책추진\n(단위: 천원)'),'천원')
        self.assertIsNone(extract_unit('단위: 원어민교육사업'))
        self.assertEqual(extract_unit('(단위: 백만 원, %)\n(단위: 천원)'),'백만원 / 천원')
    def test_rediscovery_retains_text_block_provenance(self):
        c=sqlite3.connect(':memory:')
        c.execute('CREATE TABLE documents(id TEXT PRIMARY KEY,url TEXT UNIQUE,metadata TEXT)')
        upsert_metadata(c,{'id':'a','url':'https://example.test/a','title':'old','locator_kind':'text_block','indexed_units':12})
        upsert_metadata(c,{'id':'a','url':'https://example.test/a','title':'new'})
        m=json.loads(c.execute('SELECT metadata FROM documents').fetchone()[0])
        self.assertEqual(m['title'],'new');self.assertEqual(m['locator_kind'],'text_block');self.assertEqual(m['indexed_units'],12)

    def test_hwpx_nested_table_text_is_not_duplicated(self):
        base=Path(__file__).resolve().parents[1]/'work'/'qa';base.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as folder:
            path=Path(folder)/'test.hwpx'
            with zipfile.ZipFile(path,'w') as z:
                z.writestr('Contents/section0.xml','<s><p><t>제목</t><table><p><t>예산 1,234</t></p></table><t>끝</t></p></s>')
            text='\n'.join(t for _,t in parse(path,'hwpx'))
            self.assertEqual(text.count('1,234'),1)
            self.assertIn('제목',text);self.assertIn('끝',text)

    def test_pdf_page_numbers_do_not_shift_when_blank_page_skipped(self):
        d=fitz.open();d.new_page();p=d.new_page();p.insert_text((50,50),'Budget source amount 3,940,847,350 with sufficient text.')
        count,rows=_parse_pdf(d.tobytes(),'sample')
        self.assertEqual(count,2);self.assertEqual(rows[0][2],2);self.assertIn('3,940,847,350',rows[0][3])

    def test_hwpx_rejects_dtd_and_entity_declarations(self):
        payloads=[
            '<!DOCTYPE s><s><p><t>text</t></p></s>',
            '<!DOCTYPE s [<!ENTITY content "expanded">]><s><p><t>&content;</t></p></s>',
            '<!DOCTYPE s SYSTEM "https://example.invalid/untrusted.dtd"><s><p><t>text</t></p></s>',
        ]
        base=Path(__file__).resolve().parents[1]/'work'/'qa';base.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=base) as folder:
            path=Path(folder)/'untrusted.hwpx'
            for payload in payloads:
                with self.subTest(payload=payload):
                    with zipfile.ZipFile(path,'w') as z:
                        z.writestr('Contents/section0.xml',payload)
                    with self.assertRaises(DTDForbidden):parse(path,'hwpx')

if __name__=='__main__':unittest.main()
