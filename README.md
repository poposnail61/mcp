# Cowork MCP Plugin

여러 기기에서 파일을 공유하고 협업할 수 있는 MCP(Model Context Protocol) 플러그인입니다.

## 기능

- **파일 업로드** - 텍스트 및 바이너리 파일(base64) 업로드
- **파일 다운로드** - 워크스페이스에서 파일 읽기
- **파일 목록** - 업로드된 파일 목록 조회
- **파일 삭제** - 파일 삭제
- **파일 정보** - 파일 메타데이터 조회

## 설치

```bash
npm install
npm run build
```

## Claude Desktop 설정

`claude_desktop_config.json`에 추가:

```json
{
  "mcpServers": {
    "cowork": {
      "command": "node",
      "args": ["/path/to/cowork-mcp-plugin/dist/index.js"]
    }
  }
}
```

## 도구 사용 예시

### 파일 업로드
```
upload_file(filename="notes.txt", content="내용입니다", encoding="text")
upload_file(filename="image.png", content="<base64데이터>", encoding="base64")
```

### 파일 목록 조회
```
list_files()
```

### 파일 다운로드
```
download_file(filename="notes.txt")
```

### 파일 삭제
```
delete_file(filename="notes.txt")
```

## 여러 기기에서 사용하기

1. 이 레포지토리를 각 기기에 클론: `git clone <repo-url>`
2. 의존성 설치: `npm install && npm run build`
3. Claude Desktop 설정 파일에 MCP 서버 경로 등록
4. 업로드 폴더를 Google Drive / Dropbox 등 클라우드 스토리지에 심볼릭 링크로 연결하면 파일도 동기화 가능
