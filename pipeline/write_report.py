"""Write a human-readable audit from the exact deployment snapshot."""
import json
from collections import Counter
from collect import ROOT
c=json.loads((ROOT/'snapshot/catalog.json').read_text(encoding='utf-8'));s=c['summary'];docs=c['documents']
fmt=lambda n:f'{n:,}'
lines=['# 수집·색인 보고서','',f"스냅샷 생성: {s['generated_at']}",'',
       '| 구분 | 건수 |','|---|---:|',
       f"| 발견한 첨부 URL | {fmt(s['documents'])} |",
       f"| 다운로드 완료 | {fmt(s['downloaded_documents'])} |",
       f"| 검색 가능한 문서 | {fmt(s['snapshot_documents'])} |",
       f"| PDF 전체 쪽 | {fmt(s['pdf_pages'])} |",
       f"| 검색 가능한 PDF 쪽 | {fmt(s['snapshot_pages'])} |",
       f"| 비PDF 본문 블록 | {fmt(s['snapshot_text_blocks'])} |",
       f"| 미추출 PDF 쪽 | {fmt(s['unindexed_pdf_pages'])} |",
       f"| 배포 검색 자산 | {s['snapshot_bytes']/1e6:.1f} MB |",'',
       '문서 수는 서로 다른 첨부 URL 수다. 전체 예산서와 부서별 분할본이 함께 있어 내용 중복이 있다. 페이지 수를 고유 예산 항목 수로 해석하지 않는다.',
       '', '## 출처별 처리','', '| 출처 | 발견 | 다운로드 | 검색 문서 |','|---|---:|---:|---:|']
for category,row in s['category_stats'].items():lines.append(f"| {category} | {row['discovered']} | {row['downloaded']} | {row['indexed_documents']} |")
lines+=['','## 문서 상태','','| 상태 | 건수 |','|---|---:|']
for k,v in s['status_counts'].items():lines.append(f'| {k} | {v} |')
lines+=['','## 확인한 한계','',s['page_extraction_note'],
        '', '연도별 예산 메뉴는 2007~2026년 840건을 탐색했다. 관련 게시판은 표시된 마지막 페이지까지 첨부 목록을 확인했다. 시청 전체 부서별 게시물이나 외부 기관 공고까지 완전히 탐색했다는 뜻은 아니다.',
        '', '재정공시의 현재 다운로드 /fnct/ 경로는 공식 robots.txt 제외 경로다. 검색에 남은 2024년 정적 대체 주소도 GET 404를 확인했다. 이 경로 자료는 자동수집에서 제외했다.',
        '', '## 실패 원문','']
for d in docs:
    if d['status']=='failed':lines.append(f"- [{d['title']}]({d['url']}): {d['error'].strip()}")
lines+=['','## 부분 추출 아카이브','']
for d in docs:
    if d['status']=='partial_text':lines.append(f"- [{d['title']}]({d['url']}): 본문 {d['indexed_units']}개 블록, 미처리 내부 파일 {len(d.get('extraction_warnings',[]))}건. 상세 사유는 catalog.json의 extraction_warnings.")
lines+=['','## 결과 해석','',
        '검색은 한국어 n-gram을 사용하는 검색형 RAG다. 의미 임베딩이나 OCR은 수행하지 않았다. HWP 5, HWPX, XLS, XLSX를 처리했고 구형 HWP 3.x는 변환이 필요하다. 원문 표의 열 배치·모든 수치를 전수 검수하지 않았다. 검색 실패를 해당 예산의 부재라고 답하지 않는다.',
        '', '배포된 화면과 MCP는 이 스냅샷을 읽는다. 자동 동기화 일정은 등록하지 않았다.']
(ROOT/'docs/COLLECTION_REPORT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'report':'docs/COLLECTION_REPORT.md','summary':s},ensure_ascii=False))
