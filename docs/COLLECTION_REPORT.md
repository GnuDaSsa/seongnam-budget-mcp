# 수집·색인 보고서

스냅샷 생성: 2026-11-07T14:41:51.602807+00:00

| 구분 | 건수 |
|---|---:|
| 발견한 첨부 URL | 960 |
| 다운로드 완료 | 954 |
| 검색 가능한 문서 | 917 |
| PDF 전체 쪽 | 145,819 |
| 검색 가능한 PDF 쪽 | 106,719 |
| 비PDF 본문 블록 | 5,667 |
| 미추출 PDF 쪽 | 39,100 |
| 배포 검색 자산 | 101.3 MB |

문서 수는 서로 다른 첨부 URL 수다. 전체 예산서와 부서별 분할본이 함께 있어 내용 중복이 있다. 페이지 수를 고유 예산 항목 수로 해석하지 않는다.

## 출처별 처리

| 출처 | 발견 | 다운로드 | 검색 문서 |
|---|---:|---:|---:|
| 결산현황 | 46 | 46 | 43 |
| 기금운용현황 | 41 | 41 | 40 |
| 성과계획서 | 21 | 21 | 17 |
| 연도별 예산서 | 840 | 834 | 805 |
| 중기지방재정 | 1 | 1 | 1 |
| 투자심사 | 11 | 11 | 11 |

## 문서 상태

| 상태 | 건수 |
|---|---:|
| failed | 6 |
| indexed | 759 |
| indexed_text | 78 |
| partial_ocr_required | 115 |
| partial_text | 2 |

## 확인한 한계

30자 미만 페이지는 색인에서 제외. 빈 페이지와 스캔/OCR 필요 페이지가 함께 포함되며 OCR을 수행했다는 뜻이 아님.

연도별 예산 메뉴는 2007~2026년 840건을 탐색했다. 관련 게시판은 표시된 마지막 페이지까지 첨부 목록을 확인했다. 시청 전체 부서별 게시물이나 외부 기관 공고까지 완전히 탐색했다는 뜻은 아니다.

재정공시의 현재 다운로드 /fnct/ 경로는 공식 robots.txt 제외 경로다. 검색에 남은 2024년 정적 대체 주소도 GET 404를 확인했다. 이 경로 자료는 자동수집에서 제외했다.

## 실패 원문

- [2010년 세입세출예산서 · 1차 추경예산 - 성남시 고시 제2010-95호 · 원문 확인 · 세출예산사업명세서(일반회계) · 수정구·동주민센터](https://www.seongnam.go.kr/humanframe/file/sncity/bgt/2010/10385_16.pdf): curl: (22) The requested URL returned error: 404
- [2010년 세입세출예산서 · 1차 추경예산 - 성남시 고시 제2010-95호 · 원문 확인 · 세출예산사업명세서(일반회계) · 중원구·동주민센터](https://www.seongnam.go.kr/humanframe/file/sncity/bgt/2010/10385_17.pdf): curl: (22) The requested URL returned error: 404
- [2010년 세입세출예산서 · 1차 추경예산 - 성남시 고시 제2010-95호 · 원문 확인 · 세출예산사업명세서(일반회계) · 분당구·동주민센터](https://www.seongnam.go.kr/humanframe/file/sncity/bgt/2010/10385_18.pdf): curl: (22) The requested URL returned error: 404
- [2010년 세입세출예산서 · 1차 추경예산 - 성남시 고시 제2010-95호 · 상수도공기업특별회계 · 세출예산사업명세서(기타 특별회계) 파일열기 · 세출예산사업명세서(기타 특별회계) 상수도공기업특별회계(세입)](https://www.seongnam.go.kr/humanframe/file/sncity/bgt/2010/10385_19.pdf): curl: (22) The requested URL returned error: 404
- [2010년 세입세출예산서 · 1차 추경예산 - 성남시 고시 제2010-95호 · 상수도공기업특별회계 · 세출예산사업명세서(기타 특별회계) 파일열기 · 상수도공기업특별회계(세입)](https://www.seongnam.go.kr/humanframe/file/sncity/bgt/2010/10385_20.pdf): curl: (22) The requested URL returned error: 404
- [2010년 세입세출예산서 · 1차 추경예산 - 성남시 고시 제2010-95호 · 상수도공기업특별회계 · 세출예산사업명세서(기타 특별회계) 파일열기 · 상수도공기업특별회계(세출)](https://www.seongnam.go.kr/humanframe/file/sncity/bgt/2010/10385_21.pdf): curl: (22) The requested URL returned error: 404

## 부분 추출 아카이브

- [2010회계연도결산서.zip](https://www.seongnam.go.kr/bbs030503/getFile?bbsCrtSn=17012&pstSn=75815&fileNo=36558): 본문 66개 블록, 미처리 내부 파일 18건. 상세 사유는 catalog.json의 extraction_warnings.
- [2011회계연도세입.세출결산(고시).zip](https://www.seongnam.go.kr/bbs030503/getFile?bbsCrtSn=17012&pstSn=75813&fileNo=36556): 본문 63개 블록, 미처리 내부 파일 27건. 상세 사유는 catalog.json의 extraction_warnings.

## 결과 해석

검색은 한국어 n-gram을 사용하는 검색형 RAG다. 의미 임베딩이나 OCR은 수행하지 않았다. HWP 5, HWPX, XLS, XLSX를 처리했고 구형 HWP 3.x는 변환이 필요하다. 원문 표의 열 배치·모든 수치를 전수 검수하지 않았다. 검색 실패를 해당 예산의 부재라고 답하지 않는다.

배포된 화면과 MCP는 이 스냅샷을 읽는다. 자동 동기화 일정은 등록하지 않았다.
