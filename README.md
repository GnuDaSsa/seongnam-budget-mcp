# 성남 예산 아카이브

[![CI](https://github.com/GnuDaSsa/seongnam-budget-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/GnuDaSsa/seongnam-budget-mcp/actions/workflows/ci.yml)

성남시청 공개 예산서를 수집하고 원문 위치로 검색하는 공개 읽기 전용 MCP·웹앱입니다. 제품 요구사항은 [PRD](docs/PRD.md), 재사용 지시문은 [META_PROMPT](docs/META_PROMPT.md), 재수집·배포는 [운영 안내](docs/OPERATIONS.md)를 읽으세요.

- GitHub: https://github.com/GnuDaSsa/seongnam-budget-mcp
- 공공 GitLab: https://gitlab.aigov.go.kr/sajw1994/snbudget
- 공개 사이트: https://seongnam-budget-research-20261107.gnudas0923.chatgpt.site
- 인증 없는 공개 MCP: https://seongnam-budget-research-20261107.gnudas0923.chatgpt.site/public-mcp

## 실행

Python 3.13+, Node.js 22+가 필요합니다. Windows에서는 시스템 curl.exe를 사용합니다. TLS 검증을 끄지 않습니다.

```powershell
python -m pip install -r requirements.txt
python pipeline/collect.py --discover
python pipeline/discover_related.py
python pipeline/collect.py --collect --workers 2
python pipeline/parse_office.py
python pipeline/build_snapshot.py
node scripts/build.mjs
python -m unittest discover -s tests -p test_pipeline.py -v
node --test tests/worker.test.mjs
node scripts/dev.mjs
```

미리보기: http://127.0.0.1:8765 . MCP: http://127.0.0.1:8765/public-mcp . 로컬 서버는 루프백에만 바인딩합니다. 임의로 외부에 공개하지 마세요. 원격 이용은 배포된 공개 Sites을 사용합니다.

수집 재실행은 이미 완료한 원문을 재사용하고 discovered/failed 문서만 처리합니다. 부분 OCR 문서·지원하지 않는 문서의 미처리를 숨기지 않습니다. 외부 API 키 없이 검색이 동작합니다. 사이트 자체에는 생성 모델 채팅창이 없고 ChatGPT가 MCP 결과를 읽어 답변합니다.

## 구조

```
pipeline/       공식 출처 발견, 다운로드, PDF 추출, 검색 스냅샷 생성
data/           원본·수집 HTML·SQLite·상태 (Git 제외)
snapshot/       배포용 문서 목록·압축 검색색인·페이지 텍스트
worker/server.js MCP/검색/문서 API
web/index.html  검색·원문목록·수집상태·연결 안내
scripts/        빌드·로컬 서버
tests/          실제 자료를 사용하는 통합 테스트
docs/           PRD·메타프롬프트·운영 및 검증 기록
```

연결 방법은 [MCP 연결 안내](docs/MCP_CONNECT.md)를 참고하세요. 일반 질문에는 `budget_research`를 먼저 사용합니다.

사업비·통계목 조회의 문서 선택과 표시 기준은 [세출예산 근거 우선 조회](docs/EXPENDITURE_SEARCH.md)를 참고하세요. 성과계획서의 요약 수치와 세출명세서의 편성 내역을 구분합니다.

수정 완료 후의 GitHub·GitLab·사이트·MCP 반영은 [통합 배포 절차](docs/RELEASE.md)를 따릅니다. 과거 일반 ChatGPT 화면 검증은 [실제 사용 기록](docs/CHATGPT_E2E.md), 조회 기준은 [조회 규칙](docs/QUERY_POLICY.md)에 있습니다.

## MCP 계약

| 도구 | 사용 |
|---|---|
| budget_research | query와 필터. 검색·원문 근거를 한 번에 반환 |
| search | query. ChatGPT 호환 id/title/url 반환 |
| fetch | search 결과의 id. 원문 전문 반환 |
| search_budget | query, year?, budget_type?, revision?, category?, limit? |
| get_budget_page | document_id, page (검색 결과의 조회 키. PDF 쪽수 또는 본문 블록) |
| list_budget_documents | query?, year?, budget_type?, category?, offset?, limit? |
| get_collection_status | 입력 없음 |
| build_rag_context | query와 필터. 최대 4개 원문 페이지, 생성 수행 안 함 |

MCP `server/discover`, `tools/list`, `tools/call` 및 이전 `initialize` 형식을 제공합니다. HTTP POST JSON-RPC로 요청합니다. Sites 게시 시 생성되는 개인 플러그인을 사용하면 별도 앱을 만들 필요가 없습니다. 사이트의 공개자료와 사이트 접근 권한은 별개이며 사용자가 공개 사이트·공개 MCP를 명시했으므로 사이트는 공개이며 /public-mcp는 무인증입니다.

## 사실성과 한계

- 검색은 한국어 n-gram과 다국어 임베딩의 하이브리드 방식이며 의미 리랭킹을 수행합니다.
- 원본 표를 텍스트로 읽을 때 셀 순서가 달라질 수 있습니다. 금액은 원문 링크와 단위를 확인하세요. 자동 집계 기능은 없습니다.
- HWP/HWPX/XLS/XLSX는 문단·시트/행 기준으로 추출합니다. PDF 쪽수를 만들지 않습니다. XLS는 저장된 계산 결과를, XLSX는 수식 원문을 읽으며 매크로·수식을 실행하지 않습니다.
- 산하기관 자료는 법령이 홈페이지 공시를 의무로 정한 것에 한해 robots 제한 경로에서도 수집합니다(근거 조문은 [산하기관 공개자료](docs/AFFILIATES.md)). 근거가 없는 제한 경로와 지방의회 회의록 부록은 수집하지 않습니다. 현재 로컬 카탈로그는 7개 기관 25개 문서 515쪽이며 스캔본 9건 78쪽은 OCR을 하지 않아 미수록입니다. 이 수치는 운영 서버에 아직 게시되지 않았습니다.
- 30자 미만 PDF 페이지는 색인에서 제외됩니다. 빈 쪽과 스캔 등이 함께 포함되므로 전부 스캔이라고 단정하지 않습니다. OCR 및 시청 전체 부서별 산발 자료 탐색은 완료되지 않았습니다.
- 시 재정공시(예산기준·결산기준)의 /fnct/ 다운로드는 공식 robots.txt 제외 경로입니다. 「지방재정법」 제60조에 따른 공시 근거는 있으나 시 자료에 넣으면 전체 벡터 색인을 다시 만들어야 하고 배포 용량 한도에 가까워 이번 범위에서는 수집하지 않았습니다.
- 전체 PDF와 부서별 분할 PDF가 함께 있습니다. 검색 결과는 동일 텍스트 해시로 중복 제거하지만 문서 수는 원문 링크 수입니다.
- 표시 시각은 스냅샷 생성 시각입니다. 무인 갱신 스케줄은 등록하지 않았습니다.
- 관련 게시판에서 파악한 연도는 파일명/제목 기준입니다. 중기계획처럼 연도 미확정인 문서는 null로 둡니다.

## 공식 참고

- [성남시 연도별 예산서](https://www.seongnam.go.kr/cn03050201)
- [ChatGPT MCP 연결 안내](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [Cloudflare 정적 자산 바인딩](https://developers.cloudflare.com/workers/static-assets/binding/)
- [MCP 2026-07-28 개요](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

배포는 `.openai/hosting.json`의 기존 project_id를 유지하고 Sites source workflow로 소스·빌드 산출물의 동일 커밋을 게시합니다. 원본 PDF와 비밀키를 Git에 추가하지 마세요.


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


## 기본 조회 규칙

연도 생략은 **2026년**입니다. 사업별 답변에 부서·정책사업·단위사업·세부사업·편성목·통계목을 표시합니다. [조회 정책](docs/QUERY_POLICY.md), [공개 MCP 사례 검토](docs/MCP_DESIGN_REVIEW.md)를 참고하세요.

## GitHub 소스와 검색 데이터

공개 레포는 코드·정책·테스트·문서·데이터 체크섬만 관리합니다. 원본 PDF, SQLite, 벡터 파일은 커밋하지 않습니다.

```sh
npm ci
npm run test:unit
npm run snapshot:download
npm run build
npm test
npm run evaluate
npm run dev
```

스냅샷은 공개 배포 저장소에서 내려받으며 `snapshot/assets.json`에 고정한 SHA-256을 검증합니다. 자료 재수집으로 코퍼스가 바뀌면 임베딩과 ANN을 다시 생성하고 카탈로그 해시와 함께 갱신해야 합니다. 원본 수집부터 다시 만들 때는 위 수집 단계 이후 `pipeline/build_terms.py`, `pipeline/download_model.py`, `pipeline/build_vectors.py`, `pipeline/build_ann.py`의 실행 인자를 확인하세요.

서버 운영 환경에는 OpenAI API 키가 필요하지 않습니다. `.env*`는 커밋 금지입니다. 신규 배포는 자신의 Site 프로젝트 ID와 호스팅 환경을 사용해야 합니다.

## 2026-11-10 서버 0.4.0 변경

- 총액 질문은 모든 연도에서 해당 연도 본예산 총괄표 1쪽을 직접 읽습니다. 합계·단위가 대조되면 `answer_card`, 대조되지 않으면 원문만 반환합니다.
- 편성 구분을 밝히지 않은 세출 사업의 연도 비교는 연도별 본예산으로 맞춥니다.
- 비교 응답의 근거 본문은 최상위 `evidence`에 한 번만 있고 `per_year[]`는 `evidence_ids`만 가집니다. `per_year[].evidence`를 읽던 클라이언트는 최상위 `evidence`를 사용해야 합니다.
- 응답의 `match_quality.level`(verified / keyword / semantic_bridge / semantic_only / none)로 일치 신뢰도를 구분합니다. `semantic_only`는 같은 사업이라는 단정 근거가 아닙니다.
- 깨진 인코딩 요청은 오류로 처리합니다.
- "지출", "비율", "시도비" 같은 분석 요청어는 필수 검색어에서 뺍니다. 결산을 묻지 않으면 시 결산서를 근거로 반환하지 않습니다.
- 같은 세부사업이 여러 부서에 편성된 질문은 `business_rollup.rows[]`에 부서별 행을 모두 반환하고, 검산이 맞을 때만 `calculated_total`(계산값)을 제공합니다.
- 부서 하나·연도 하나의 세출 질문은 `department_overview`로 본예산과 수록된 추경 회차의 부서 합계, 금액순 세부사업, 계산값 `latest_amounts`, `largest_business`를 반환합니다. "추경 포함"은 본예산과 추경을 함께 조회합니다. 수록되지 않은 추경 회차와 스캔 쪽은 반영되지 않습니다.
- 연도는 한 번에 최대 8개까지 조회합니다. 4개 이상은 연도별 사업 행 주변만 간추려 반환합니다.
- 정답셋 64개 질의(`tests/fixtures/golden-queries.json`)와 평가기(`npm run evaluate`)를 추가했습니다. 정답셋은 모델이 초안을 만들고 원문으로 대조한 것이며 사람 검수본이 아닙니다. 로컬 빌드 결과 58/64이며 풀어 쓴 의미 질의는 8개 중 6개가 풀리지 않았습니다. 이 변경은 운영 서버에 아직 게시되지 않았고 측정 표와 한계는 [검증 기록](docs/VALIDATION.md)에 있습니다.
