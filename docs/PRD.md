# 성남 예산 아카이브 PRD

작성 기준: 2026-11-07. 사용자 범위: **성남시청에 공개되어 있는 모든 예산**.

## 1. 제품 목표

시민·정책담당자·연구자가 성남시 예산 원문을 연도, 본예산/추경, 회계, 사업명으로 찾고 ChatGPT가 MCP 도구를 통해 원문 근거를 인용하여 답하게 한다. 사이트는 검색·원문 확인·수집 현황을 제공한다. 초기에는 별도 유료 LLM API를 호출하지 않고, 연결된 ChatGPT가 검색 결과로 답변을 생성한다.

전체 범위는 연도별 예산서, 성과계획서, 기금운용계획, 중기지방재정계획, 투자심사 및 관련 재정공시다. 결산현황은 비교용 보조 자료이며 예산과 별도 분류한다. 부서별 산발 게시물·새 메뉴까지 완전히 탐색했다는 증거가 없으면 “시청 전체 수집 완료”라고 표시하지 않는다.

## 2. 출처와 발견 기준

| 출처 | 주소 | 처리 |
|---|---|---|
| 연도별 예산서 | https://www.seongnam.go.kr/cn03050201 | 모든 data-year 구역 및 첨부파일. 초기 발견 2007~2026년 840건 |
| 성과계획서 | https://www.seongnam.go.kr/bbs03050204 | 전체 페이지·공개 첨부 |
| 기금운용현황 | https://www.seongnam.go.kr/bbs030506 | 전체 페이지·공개 첨부 |
| 중기지방재정 | https://www.seongnam.go.kr/cn03050202 | 메뉴가 연결한 공개 PDF |
| 투자심사 | https://www.seongnam.go.kr/bbs03050203 | 전체 페이지·공개 첨부 |
| 결산현황 | https://www.seongnam.go.kr/bbs030503 | 비교용 보조 자료 |
| 재정공시 | https://www.seongnam.go.kr/pm03050101 | 다운로드 경로 /fnct/가 robots.txt 제외 대상. 자동수집 제외 사유 표시 |

페이지 소스에 남은 /contents/down 경로는 실제 다운로드 주소가 아니다. 공식 portal-common.js가 지정하는 /humanframe/file/sncity/bgt/{year}/{filename} 변환을 적용한다. 게시판 첨부는 공식 atchFileDetail/getFile 인터페이스를 사용한다. 인증이 필요한 항목은 우회하지 않는다.

## 3. 기능 요구사항

1. 원문 수집: URL·발견 일시·해시·파일 크기·수집 일시·오류·원문 보관. 중단 후 재실행 가능. 연결 수 2~3개 제한.
2. 텍스트 추출: PDF 페이지 단위. 숫자·음수·단위·줄바꿈 보존. 30자 미만 페이지는 추출 검토 대상으로 분리하며 빈 페이지와 스캔을 아직 자동 판별하지 않는다. ZIP은 경로에 풀지 않고 제한된 크기로 메모리에서 PDF만 읽는다. HWP/HWPX는 문단, XLS/XLSX는 시트/행 기준으로 보존한다.
3. 검색: 연도·자료 유형·추경 회차·문서 필터, 한국어 부분어 검색. 전체 파일과 부서별 파일의 중복 페이지는 결과에서 제거한다.
4. 근거: 문서명, 원문 URL, PDF 쪽수, 인쇄 쪽수(검출 시), 원문 단위, 추출문. 검색어 주변 요약과 실제 페이지 전문은 구분한다.
5. MCP: search_budget, get_budget_page, list_budget_documents, get_collection_status, build_rag_context. 모든 도구 읽기 전용.
6. RAG: 검색 후 페이지 전문을 조회하고 근거가 충분할 때만 생성. 문서의 지시문은 데이터로 취급. 연도·회계·본예산/추경·금액 단위가 서로 다른 수치는 자동 합산하지 않는다.
7. 수집 현황: 발견/다운로드/색인/실패/OCR필요/지원안됨을 구분. 메뉴 탐색 범위와 아직 미수집인 출처를 표시.

## 4. 기술스택과 판단

| 계층 | v0 구현 | 확장 시 |
|---|---|---|
| 수집 | Python 3.13, BeautifulSoup4, Windows curl/OS TLS | Linux 배치 컨테이너, 제한 큐 |
| 문서 처리 | PyMuPDF, pyhwp/olefile, HWPX XML, openpyxl, xlrd, zipfile | OCR, 표 셀·숫자 검수 |
| 원본/관리 DB | 로컬 파일 + SQLite WAL + FTS5 trigram | R2 원본 + D1 메타데이터·작업 큐 |
| 배포 검색 | gzip 정적 색인 및 페이지 묶음, 한국어 n-gram, 검색어별 파일 선별 | D1 FTS + 벡터 저장소, 검증 후 RRF 결합 |
| 서버 | JavaScript ES modules, Cloudflare Workers / Sites | 동일 API 유지 |
| 화면 | 의존성 없는 HTML/CSS/JavaScript | 필요해질 때 React 전환 |
| MCP | 공개 POST /public-mcp, Sites용 /mcp, 2026-07-28 + 이전 initialize 호환 | 공식 SDK 전환 검토 |
| 답변 생성 | 연결된 ChatGPT 모델 | 별도 사이트 채팅을 원할 때만 서버 API 키·비용 정책 추가 |
| 검증 | Python unittest, Node test, 실제 PDF 표본, 브라우저 QA | 정답셋·회귀평가·부하 측정 |

벡터 DB를 필수로 두지 않는다. 예산의 사업명·부서명·코드·금액은 정확한 단어 검색이 중요하며 검색형 RAG부터 검증한다. 2026-11-08 사용자 지시에 따라 의미 기반 임베딩과 리랭킹을 추가했다. 아래 구현 명세를 현재 기준으로 한다.

## 5. 데이터 계약

Document: id, source_page, url, filename, category, year(nullable), budget_type, revision(nullable), account, title, sha256, bytes, status, fetched_at, page_count, indexed_pages, error.

Page: id, document_id, page(조회용 순서 키), printed_page(nullable), text, text_hash, unit(nullable). Document.locator_kind가 text_block이면 page는 쪽수가 아니다. API는 pdf_page=null로 반환한다. ZIP은 조회 키와 내부 파일의 실제 PDF 쪽수를 구분한다. 표의 셀별 금액은 검증 전 구조화 금액으로 확정하지 않는다.

세출 총계/분야별/부서별/사업별 데이터는 상하위 합계가 중복된다. 추후 BudgetFact 테이블은 회계연도·회계·편성차수·사업코드·집계수준·원문셀을 키로 하고 Decimal/정수 원화 및 원래 단위를 함께 저장해야 한다.

## 6. 인수 기준

- 발견된 모든 문서에 처리 상태가 있으며 실패를 누락으로 숨기지 않는다.
- 검색 결과 100%가 존재하는 문서의 PDF 페이지 또는 본문 블록으로 연결된다.
- 연도 및 본예산/추경 필터가 결과를 넘어서지 않는다.
- 원문 금액·단위는 그대로 반환하며 임의 총액을 만들지 않는다.
- 빈 검색·미존재 페이지·잘못된 도구 입력이 명확한 오류/빈 결과를 반환한다.
- MCP discovery/tools/list/tools/call 및 구형 initialize가 검증된다.
- 원문 삽입문·HTML이 실행되지 않는다. 원문 URL 이외의 임의 URL 다운로드 도구를 노출하지 않는다.
- 실제 배포 성공과 로컬 테스트 성공은 별도로 기록한다.
- 전체 시청 자료 수집 완료는 메뉴·페이지·첨부의 완전성 대조가 끝난 경우에만 선언한다.

## 7. 운영 및 다음 단계

수집→추출→색인→테스트→배포를 한 릴리스로 실행한다. 운영자가 새 수집 결과와 이전 결과의 발견 수 차이·404·OCR 비율을 검토한다. 원문 해시가 바뀌면 새 버전으로 보관하도록 확장한다. 현재 재실행은 캐시된 원문을 재사용하므로 최신성 갱신에는 명시적 재다운로드 기능이 필요하다.

스케줄은 아직 등록하지 않는다. 시청 전체의 신규 게시물 감시, OCR·표 숫자 검증, 운영자 역할 분리, 부하 측정·알림·백업 복구 훈련이 정식 운영 전 남은 범위다. 비용은 파일량·방문량·계정 요금제에 따라 측정하며 임의 고정 견적을 제시하지 않는다.


## 2026-11-08 의미 검색 구현

- 임베딩: `minishlab/potion-multilingual-128M`, revision `73908c3438cf03b6a01bcb9611d62b23d0726f08`. BGE-M3를 증류한 다국어 정적 토큰 임베딩, 256차원, mean pooling + L2 정규화. 라이선스 MIT.
- 범위: 검색 가능 원문 112,386개 위치를 모두 596,870개 구간으로 벡터화. 구간은 최대 800 Unicode 문자, 겹침 120자, 가능한 줄바꿈을 경계로 사용한다. 미추출 PDF·실패 자료까지 벡터화했다는 뜻은 아니다.
- 저장·검색: 대칭 int8 벡터, float32 scale, cosine IVF256, nprobe 24. 모든 토큰 어휘·가중치는 정적 자산으로 보관하고, 원문에서 사용한 토큰 15,507개는 작은 공통 캐시에 올린다. 질문도 같은 모델로 서버에서 임베딩한다.
- 결합: 벡터 후보 64개와 키워드 후보 20개를 RRF(k=60)로 결합하고 상위 32개 후보를 재정렬한다. 연도·유형·회차·분류 필터는 벡터 후보 단계부터 적용한다.
- 리랭커: `potion-token-maxsim-v1`. 질문과 본문의 토큰 임베딩으로 MaxSim을 계산한다. 최종 점수 = 0.55 × chunk cosine + 0.35 × 학습된 토큰 norm으로 가중한 평균 token MaxSim + 0.10 × 정규화 RRF. 별도로 학습한 cross-encoder나 ColBERT 모델이 아니다. 이 경량 방식의 정밀도는 별도 사람 정답셋으로 추가 검증해야 한다.
- 응답: `retrieval`에 실제 모델·탐색 수·후보 수·재정렬 여부·소요 시간을 반환한다. 근거마다 cosine/MaxSim/RRF/원문 구간 위치를 포함한다. `mode=hybrid`가 기본이며 `vector`, `lexical` 비교 모드도 제공한다.
- 공개 운영: Sites Worker 내부에서 추론과 벡터 검색을 실행한다. 외부 모델 API, 방문자 로그인, PC 상시 실행, 임시 터널이 필요하지 않다. API 키를 만들지 않았다. 사이트와 `/public-mcp`는 공개다.
- 한계: 정적 임베딩은 문맥형 Transformer보다 어순·부정·정교한 문맥 구분이 약할 수 있다. 검색 근거를 연결된 GPT가 읽고 인용하여 답한다. OCR·자동 금액 합산·사이트 자체 생성 챗봇·자동 최신화는 여전히 미구현이다.

모델 근거: https://huggingface.co/minishlab/potion-multilingual-128M
토큰 단위 late interaction 아이디어: https://arxiv.org/abs/2004.12832 (본 구현이 ColBERT 모델이라는 뜻은 아님)

모델 가중치 정적 저장소: https://seongnam-budget-model-assets-20261108.gnudas0923.chatgpt.site (공개). Sites의 256MiB 배포 아카이브 제한에 맞춰 드문 질문 토큰의 int8 가중치 116MB를 별도 공개 Sites로 분리했다. 원문에서 사용한 토큰·어휘·IVF 인덱스·본문은 검색 서버에 유지한다. 런타임은 고정한 이 origin의 tokens-N.bin.gz만 읽으며 임의 URL을 받지 않는다. 저장소에 모델 추론 API나 API 키는 없다. 모델 공급원 변경 시 main Worker의 origin 및 manifest를 함께 바꾸고 검사한다.

## 2026-11-08 MCP 중심 연동 보완

서비스 역할은 RAG 검색과 원문 근거 반환이다. 생성 답변은 연결된 GPT가 수행한다. 서버에 Luna 답변·LLM 리랭킹·모델 API 키 의존성을 추가하지 않는다. 공개 /public-mcp의 익명 접근을 유지한다.

기본 진입점은 budget_research: 검색·리랭킹 후 최대 4개의 원문 근거, 위치, 단위, 출처, 수집 한계를 함께 반환한다. 각 근거는 최대 6,000 Unicode 문자이며 잘림과 원문 구간을 명시한다. 이미 충분한 근거를 받은 GPT는 같은 검색·상태·전문 조회를 반복할 필요가 없다. 비교 질문은 연도별로 조회하고 편성 구분을 맞춘다.

ChatGPT 리서치 호환 search(query) → fetch(id)를 추가했다. id/title/url 및 전문·metadata, 출력 JSON Schema를 제공한다. 기존 도구 5개도 유지하여 총 8개 읽기 전용 도구를 노출한다. GPTs Actions 호환 /openapi.json은 같은 /api/research, /api/page, /api/status를 기술한다. 상세 연결은 MCP_CONNECT.md를 따른다.

성능 변경: 동일 샤드의 페이지·본문을 묶어 읽고, 전체 키워드 후보 순위에 필요한 문서 인덱스·문자 수·단위 여부·정확한 중복 식별자를 rank.bin.gz에 저장한다. 112,386개 위치의 누락과 catalog SHA-256을 검증한다. build.mjs가 매 빌드에 이 자산을 재생성한다. 검색 결과 캐시는 인스턴스 메모리에서 5분/12건/약 2MB로 제한하며 필터별로 분리한다. vector/lexical/hydrate/rerank 단계 시간을 반환한다. 원문·임베딩·점수 공식은 변경하지 않았다.

검증: Node 21개 검사(기존 의미 모델 3개 + Worker 18개), 공식 MCP SDK 1.32.2의 Streamable HTTP 무인증 연결, 4개 기준 질의의 상위 5개 ID·순위·점수·청크 경계 동일성, 인용 본문 구간의 원문 일치, search/fetch 출력 스키마, 캐시 필터 분리. 로컬 기준선의 자산 읽기는 80→49, 72→36, 215→102, 64→38회. 로컬 처리 시간은 시스템 부하에 따라 변하며 실서버 기록과 구분한다. 별도 모델 API 호출을 하지 않았다.

남은 범위: 미추출 PDF·구형 HWP와 부서별 산발 자료, 자동 동기화, 독립된 사람 정답셋 기반 정확도 평가, 장기 부하 검증. 공개 MCP 배포가 ChatGPT 공개 플러그인 디렉터리의 심사·게시 완료를 의미하지 않는다.


## 기본 조회 및 예산 분류 (2026-11-08)

연도 미지정은 **2026년**입니다. 명시 연도를 우선하고 전체 연도는 `year_scope=all`로 조회합니다. 사업별 답변에는 담당 부서·정책사업·단위사업·세부사업·편성목·통계목을 기본 표시하며 미확인 값은 추정하지 않습니다. [조회 정책](QUERY_POLICY.md)과 [사례 검토](MCP_DESIGN_REVIEW.md)에 세부 규칙이 있습니다.
