# Google Search MCP Server Bundle

이 패키지는 [Google Search MCP Server](https://github.com/mixelpixx/Google-Search-MCP-Server)의 번들 버전입니다. 모든 내부 코드가 하나의 파일(`google-search.js`)로 통합되어 있습니다.

## 설치

```bash
npm install
```

## 환경 변수 설정

Google Search API를 사용하기 위해 다음 환경 변수를 설정해야 합니다:

```bash
GOOGLE_API_KEY="your-google-api-key"
GOOGLE_SEARCH_ENGINE_ID="your-search-engine-id"
```

## 사용법

### 직접 실행
```bash
node google-search.js
```

## 포함된 도구

- `google_search`: Google 검색 수행
- `extract_webpage_content`: 웹페이지 내용 추출
- `extract_multiple_webpages`: 여러 웹페이지 일괄 추출

## 파일 구조

```
google-search-mcp/
├── google-search.js  # 번들된 메인 파일
├── package.json            # 의존성 정보
└── README.md               # 이 파일
``` 