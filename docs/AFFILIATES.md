# 산하기관 공개자료

기본 검색은 성남시청 예산자료만 대상으로 한다. 질문에서 산하기관·출연기관 포함을 명시하거나 기관명을 지정할 때만 수록된 기관 자체 자료를 함께 조회하며 성남시 근거를 먼저 반환한다. `출연금`이라는 단어만으로 기관 범위를 넓히지 않는다. `시청 예산서만`, `출연기관 제외`는 시 자료로 제한한다.

예시:

- `2026년 청소년 예산` → 성남시 자료
- `2026년 청소년 예산, 산하기관도 포함해서` → 성남시 및 수록된 기관 자료
- `성남시청소년청년재단 2025년 결산 인건비` → 성남시 및 해당 재단 자료
- `시청 예산서에 있는 문화재단 출연금만` → 성남시 자료

시의 출연금·위탁사업비와 기관 수입·지출에는 같은 재원이 포함될 수 있다. 시 총예산에 기관 예산을 자동 합산하지 않는다. 총괄표를 세부사업명세서로, 예산(안)을 확정 예산으로, 결산을 당초 예산으로 대체하지 않는다.

## 확인 범위 — 2026-11-10

[성남시 2025년 재정공시](https://www.seongnam.go.kr/contents/down/financial_disclosure/2025/2025_1.pdf) 인쇄 7쪽의 공사 1개·출연기관 7개를 조사 대상으로 삼았다. 2026년 명부 변경 여부 및 모든 기관·연도의 완전 수집을 보장하지 않는다.

| 기관 | 수록 자료 또는 수집 상태 |
|---|---|
| 성남시청소년청년재단 | 2025·2026 본예산 총괄표 각 1쪽, 2025 세입결산서 11쪽·세출결산서 137쪽 |
| 성남시의료원 | 2026 예산(안) 설명자료 5쪽 중 텍스트 3쪽, 2025 결산서(안) 총괄 3쪽 |
| 성남도시개발공사 | 2026 본예산 XLSX 공개 확인. 다운로드 경로 `/board/`의 robots 제한으로 자동수집 제외 |
| 성남산업진흥원 | robots.txt의 전체 수집 제한으로 자동수집 제외 |
| 성남문화재단 | 조회 시 웹 방화벽 차단 |
| 성남시상권활성화재단 | 예산 공시 게시글 확인, HTTPS 연결 실패로 첨부 확보 보류 |
| 성남시정연구원 | 경영공시 위치 확인, HTTPS 연결 실패로 첨부 확보 보류 |
| 성남시장학회 | 공개 2026 예산계획은 스캔 1쪽, 2025 감사보고서는 텍스트 22쪽. robots.txt HTTP500으로 자동수집 보류 |

현재 2개 기관의 6개 PDF, 156개 페이지를 검색한다. 의료원 원문의 30자 미만 2개 페이지는 색인에 없으며 OCR을 수행했다는 뜻이 아니다. 모든 산하기관이 수록됐다고 답하지 않는다.

주요 원문 위치:

- [청소년청년재단 본예산 공시](https://www.snyouth.or.kr/fmcs/284), [결산 공시](https://www.snyouth.or.kr/fmcs/286)
- [의료원 2026 예산(안)](https://www.scmc.kr/useguide/PublicView/?seq=541), [2025 결산서(안)](https://www.scmc.kr/useguide/PublicView/?seq=561)
- [도시개발공사 예산서 목록](https://www.isdc.co.kr/gov/board/govBoardList.asp?HiddenBbsNo=75&GovId=33)
- [상권활성화재단 2026 예산 공개글](https://www.smr.or.kr/base/board/read?boardManagementNo=14&boardNo=1979&menuLevel=3&menuNo=19)
- [시정연구원 경영공시](https://www.snri.re.kr/web/contents/SNRI10501000.do), [장학회 경영공시](https://snjh.or.kr/EH2024n3/C05-bulletin.asp)

## 재현 및 갱신

`pipeline/affiliate-sources.json`은 검토한 공식 HTTPS 다운로드 URL과 기관 명부다. 임의 URL이나 로그인 자료는 받지 않는다. `python pipeline/collect_affiliates.py`는 robots 정책을 확인하고 순차적으로 공개 PDF를 수집한다. TLS 인증을 끄거나 리디렉션을 자동 추적하지 않는다. 원본은 무시되는 `data/affiliates/`에 저장한다. 검토한 자료의 해시가 바뀌면 자동 색인을 중단한다.

산하기관 메타데이터는 `snapshot/affiliates/catalog.json`, 본문은 문서별 gzip 파일에 저장한다. 기존 시청 catalog·벡터 파일은 변경하지 않는다. 산하기관 검색은 키워드 방식이며 시청 의미검색과 별도로 표시한다. 전체 기관 자료의 벡터화가 완료됐다고 설명하지 않는다.

본문 gzip은 소스 저장소에 커밋하지 않는다. `snapshot/assets.json`과 catalog의 SHA256·크기로 검증한다. Sites 배포 시 catalog에 명시한 gzip만 대상 checkout의 `snapshot/affiliates/`로 복사하고 양쪽 해시를 대조한다. 이후 기존 통합 배포 절차의 build·저장·게시·MCP 확인을 수행한다.

수집기 회귀 검사는 `python pipeline/test_affiliates.py`로 실행한다. 기본/명시 포함/제외/기관 지정 및 출처 검사는 `tests/affiliates.test.mjs`를 포함한 프로젝트 테스트로 확인한다.
