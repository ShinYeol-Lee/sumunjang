# 수문장

> 물을 모을수록 돈이 되고, 모을수록 위험해진다. 상류에서 하류로 물을 차례로 넘기며 3년을 버티는 미니어처 댐 경영 게임.

비 오는 날 운동장에서 흙으로 물길을 막던 놀이를, 탁자 위 로우폴리 디오라마로 옮겼습니다.
댐 부지와 공법을 고르고, 수문을 열고 닫아 마을을 지키면서 발전·관광·용수 계약으로 돈을 모읍니다.

## 실행

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm run build    # 배포용 빌드 (dist/)
npm run check    # 타입체크 + 린트 + 단위 + 빌드 + E2E + 밸런스 봇 (약 10분)
```

## 조작

| 동작 | 마우스 | 터치 |
|---|---|---|
| 회전 | 왼쪽 드래그 | 한 손가락 드래그 |
| 줌 | 휠 | 핀치 |
| 이동 | 오른쪽 드래그 | 두 손가락 드래그 |
| 부지·댐 선택 | 클릭 | 탭 |

키보드: `Space` 일시정지, `1`·`2`·`3` 배속, `Esc` 선택 해제. 붕괴 연출은 아무 키나 눌러 건너뜁니다.

## 구조

```
src/sim/     순수 시뮬레이션 (Three.js·DOM 없음, 결정론적)
src/data/    밸런스 숫자(balance.ts)와 스테이지 정의
src/render/  Three.js 디오라마
src/ui/      HUD·화면·게임 루프
src/save/    IndexedDB 저장
src/bots/    밸런스 검수 봇 (run.ts), 분석 도구 (inspect.ts, calibrate.ts)
tests/       Vitest 단위 테스트, Playwright E2E
```

자세한 결정 기록은 `DECISIONS.md`, 1차 빌드 결과는 `REPORT.md`에 있습니다.
