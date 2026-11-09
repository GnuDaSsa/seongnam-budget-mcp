# 모델 및 라이브러리 출처

- minishlab/potion-multilingual-128M — Minish Lab, 모델 카드의 MIT 라이선스. https://huggingface.co/minishlab/potion-multilingual-128M . 배포본은 고정 revision의 가중치를 대칭 int8로 변환하고 파일을 나눴다. 원본 해시는 snapshot/semantic/manifest.json에 기록했다. 본 프로젝트가 원 모델을 학습한 것은 아니다.
- Model2Vec — Minish Lab, MIT. https://github.com/MinishLab/model2vec . 평균 풀링과 학습된 토큰 벡터의 norm을 가중치로 사용하는 방식을 따른다.
- @huggingface/tokenizers 0.2.0 — Hugging Face, Apache-2.0. https://github.com/huggingface/tokenizers.js . Precompiled normalizer를 번들에 포함한다. Unigram 검색은 메모리를 줄인 compact UTF-8 사전 위에서 실행하며 Python tokenizers와의 parity 검사를 제공한다.
- scikit-learn — BSD-3-Clause. https://github.com/scikit-learn/scikit-learn . IVF 중심점 학습에 MiniBatchKMeans를 사용한다.

원문 자료의 제공자는 성남시다. 원문 URL과 문서 해시는 각 인용에 보존한다. 사이트는 성남시 공식 서비스가 아니다.
