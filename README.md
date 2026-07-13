# 미루지말자

오늘 무조건 할 일을 끝내야 게임이 열리는 개인용 스케줄러 PWA.

## 실행 (로컬)

빌드 도구 없음. 폴더에서 정적 서버만 띄우면 됨:

```bash
python3 -m http.server 8321
# http://localhost:8321 접속
```

(`index.html`을 파일로 직접 열어도 대부분 동작하지만, PWA/알림은 http(s)에서만 작동)

## 어디서든 쓰기 (배포)

1. GitHub 저장소 만들고 이 폴더를 push
2. 저장소 Settings → Pages → Branch를 `main`으로 설정
3. `https://<아이디>.github.io/<저장소>/` 주소가 생김 — PC·폰 어디서든 접속
4. 폰: 그 주소를 열고 "홈 화면에 추가" → 앱처럼 설치됨 (오프라인 동작)

## 데이터

- 기기별 localStorage 저장 (`mnj.*` 키)
- 기기 간 이동: 기록 탭 → 내보내기(JSON) → 다른 기기에서 불러오기
- 자동 동기화는 v2 (Firebase/Supabase 검토)

## 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 구조 (오늘/루틴/인박스/가계부/기록 5탭 + 체크인·충동 모달) |
| `app.js` | 전체 로직 (게이트, 타이머, 충동 10분, 가계부, 히트맵) |
| `styles.css` | 다크 테마 스타일 |
| `manifest.webmanifest` / `sw.js` / `icon.svg` | PWA (설치·오프라인) |

## 남은 것

- PiP 미니 타이머 위젯 (PC)
- 충동-가계부 연동 강화 (충동 "했다" → 지출 입력 제안)
- 데이터 동기화 (v2)
