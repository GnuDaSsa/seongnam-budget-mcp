# 산하기관 공개자료

기본 검색은 성남시청 예산자료만 대상으로 한다. 질문에서 산하기관·출연기관 포함을 명시하거나 기관명을 지정할 때만 수록된 기관 자체 자료를 함께 조회하며 성남시 근거를 먼저 반환한다. `출연금`이라는 단어만으로 기관 범위를 넓히지 않는다. `시청 예산서만`, `출연기관 제외`는 시 자료로 제한한다.

예시:

- `2026년 청소년 예산` → 성남시 자료
- `2026년 청소년 예산, 산하기관도 포함해서` → 성남시 및 수록된 기관 자료
- `성남시청소년청년재단 2025년 결산 인건비` → 성남시 및 해당 재단 자료
- `시청 예산서에 있는 문화재단 출연금만` → 성남시 자료

시의 출연금·위탁사업비와 기관 수입·지출에는 같은 재원이 포함될 수 있다. 시 총예산에 기관 예산을 자동 합산하지 않는다. 총괄표를 세부사업명세서로, 예산(안)을 확정 예산으로, 결산을 당초 예산으로 대체하지 않는다.

## 확인 범위 — 2026-11-10

[클린아이 지방출자출연 설립현황](https://www.cleaneye.go.kr/siteGuide/iptCompStatus.do)의 성남시 출연기관 8개를 확인하고, 기존 성남도시개발공사 1개를 더해 조사 명부를 **9개 기관**으로 갱신했다. 이전 2025년 재정공시 기준 명부에서 빠졌던 성남시복지재단을 추가했다. 민간위탁시설과 성남 소재 중앙 공공기관은 이 명부와 구분한다. 명부 확인은 모든 기관·연도 자료의 수집 완료를 뜻하지 않는다.

| 기관 | 수록 자료 또는 수집 상태 |
|---|---|
| 성남시청소년청년재단 | 2025·2026 본예산 총괄표 각 1쪽, 2025 세입결산서 11쪽·세출결산서 137쪽 |
| 성남시의료원 | 2026 예산(안) 설명자료 5쪽 중 텍스트 3쪽, 2025 결산서(안) 총괄 3쪽 |
| 성남도시개발공사 | 2026 본예산 XLSX 공개 확인. 다운로드 경로 `/board/`의 robots 제한으로 자동수집 제외 |
| 성남산업진흥원 | robots.txt의 전체 수집 제한으로 자동수집 제외 |
| 성남문화재단 | 새 홈페이지 정상 응답. 예산 게시판 `/main/pst/`의 robots 제한으로 자동수집 제외 |
| 성남시상권활성화재단 | 2026 예산안 총괄표 1쪽 수록. 2025 재무상태표·운영성과표 2건 4쪽은 스캔으로 OCR 필요 |
| 성남시정연구원 | 2025·2026 본예산 총괄 및 2025 결산 총괄 각 1쪽 수록. 2024·2025 결산서 2건 43쪽은 스캔으로 OCR 필요 |
| 성남시장학회 | 공개 2026 예산계획은 스캔 1쪽, 2025 감사보고서는 텍스트 22쪽. robots.txt HTTP500으로 자동수집 보류 |
| 성남시복지재단 | 공식 경영공시의 예산·결산·감사 분류에 게시물 없음. 전체 공시 5건은 업무추진비이며 기관 전체 예산을 대신하지 않음 |

현재 **4개 기관의 10개 PDF, 160개 페이지**를 검색한다. 의료원 원문의 30자 미만 2개 페이지는 색인에 없다. 별도로 원문을 확보한 스캔 PDF 4건 47쪽은 검색 미수록이다. `summary.unindexed_pdf_pages`는 검색 수록 문서 내부의 누락 쪽수(2), `ocr_required_documents`와 `ocr_required_pdf_pages`는 통째로 OCR이 필요한 미수록 문서 수(4)와 쪽수(47)다. OCR을 수행했거나 모든 산하기관이 수록됐다고 답하지 않는다.

## 교차 조사 결과

- **클린아이**: 명부와 정식 API 안내를 확인했다. 일반 공시·첨부는 `robots.txt`가 전체 수집을 제한하므로 크롤러에 추가하지 않았다. [예산결산 OpenAPI](https://www.data.go.kr/data/15056695/openapi.do)는 인증키가 필요한 지방공기업 자료이며, [공식 명세](https://www.cleaneye.go.kr/user/openDataSetList.do?svcGubun=SS)의 보유연도는 2013~2024다. 출연기관 전체 또는 2025·2026 예산을 제공한다고 확인되지 않았다. 현재 API 실데이터는 미연결이다.
- **공공데이터포털**: 위 API 외에 성남 기관 예산·결산을 바로 내려받는 CSV/XLSX 대체본은 이번 조사에서 찾지 못했다. 직원 평균임금 자료는 예산서로 대체 수록하지 않았다.
- **성남시의회**: 산업진흥원·시정연구원·도시개발공사·문화재단의 예산 심사 및 업무보고 회의록 경로를 확인했다. 첨부 다운로드 `/record/appendixDownload.do` 등은 robots 제한이다. 회의록 발언이나 예전 회기 부록을 최신 확정 예산서로 대체하지 않았다.
- **기관별 공시**: 상권활성화재단과 시정연구원은 표준 PowerShell HTTP 도구의 기본 인증서 검증으로 접근·다운로드했다. 기존 Python TLS 오류를 자료 비공개로 해석하지 않았다. 신규 8개 PDF의 SHA256, 본문/스캔 여부, 원문 링크의 리디렉션 없는 HEAD 200 응답을 대조했다.
- **복지재단**: [공식 출범 안내](https://snvision.seongnam.go.kr/23067)와 [경영공시](https://www.snwf.or.kr/skin_nb18/bbs_list.php?unsingcode1=1181635161&unsingcode2=1764666273&unsingcode3=1764666311&code=manage_notice)를 확인했다. 시 출연금 보도자료를 기관 자체 예산서로 수록하지 않았다.

주요 원문 위치:

- [청소년청년재단 본예산 공시](https://www.snyouth.or.kr/fmcs/284), [결산 공시](https://www.snyouth.or.kr/fmcs/286)
- [의료원 2026 예산(안)](https://www.scmc.kr/useguide/PublicView/?seq=541), [2025 결산서(안)](https://www.scmc.kr/useguide/PublicView/?seq=561)
- [도시개발공사 예산서 목록](https://www.isdc.co.kr/gov/board/govBoardList.asp?HiddenBbsNo=75&GovId=33)
- [상권활성화재단 2026 예산 공개글](https://www.smr.or.kr/base/board/read?boardManagementNo=14&boardNo=1979&menuLevel=3&menuNo=19)
- [시정연구원 경영공시](https://www.snri.re.kr/web/contents/SNRI10501000.do), [장학회 경영공시](https://snjh.or.kr/EH2024n3/C05-bulletin.asp)
- [시정연구원 2026 예산](https://www.snri.re.kr/web/contents/SNRI10501000.do?schM=view&id=671), [2025 예산](https://www.snri.re.kr/web/contents/SNRI10501000.do?schM=view&id=367), [2025 결산](https://www.snri.re.kr/web/contents/SNRI10501000.do?schM=view&id=729)

## 재현 및 갱신

`pipeline/affiliate-sources.json`은 검토한 공식 HTTPS 다운로드 URL과 기관 명부다. 임의 URL이나 로그인 자료는 받지 않는다. `python pipeline/collect_affiliates.py`는 robots 정책을 확인하고 순차적으로 공개 PDF를 수집한다. TLS 인증을 끄거나 리디렉션을 자동 추적하지 않는다. 원본은 무시되는 `data/affiliates/`에 저장한다. 검토한 자료의 해시가 바뀌면 자동 색인을 중단한다.

Python TLS 연결이 실패한 두 기관의 이번 자료는 표준 인증서 검증을 사용하는 별도 HTTP 도구로 확보한 원본·robots 응답을 검증 후 캐시에 넣고 `--cached`로 처리했다. 시스템 TLS·보안 설정을 바꾸지 않았다. 향후 신규 원문을 같은 방법으로 받을 때도 정확한 원문 URL, 응답 상태·리디렉션, 크기·PDF 서명·SHA256, robots 허용 여부를 먼저 확인해야 한다. 현재 수집기가 별도 HTTP 도구를 자동 실행하는 것은 아니다.

산하기관 메타데이터는 `snapshot/affiliates/catalog.json`, 본문은 문서별 gzip 파일에 저장한다. 기존 시청 catalog·벡터 파일은 변경하지 않는다. 산하기관 검색은 키워드 방식이며 시청 의미검색과 별도로 표시한다. 전체 기관 자료의 벡터화가 완료됐다고 설명하지 않는다.

본문 gzip은 소스 저장소에 커밋하지 않는다. `snapshot/assets.json`과 catalog의 SHA256·크기로 검증한다. Sites 배포 시 catalog에 명시한 gzip만 대상 checkout의 `snapshot/affiliates/`로 복사하고 양쪽 해시를 대조한다. 이후 기존 통합 배포 절차의 build·저장·게시·MCP 확인을 수행한다.

수집기 회귀 검사는 `python pipeline/test_affiliates.py`로 실행한다. 기본/명시 포함/제외/기관 지정 및 출처 검사는 `tests/affiliates.test.mjs`를 포함한 프로젝트 테스트로 확인한다.
