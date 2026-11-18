# cc-progress-panel

## 개요

- Claude Code 채팅 옆에 "진행 상황" 패널을 띄우는 mod
- 할 예정인 일, 지금 하는 일, 끝났거나 막힌 일을 단계 목록으로 보여 줌
- 단계 목록은 Claude가 일을 하면서 직접 적고 고침
- 여러 단계로 나뉘는 일이면 종류와 상관없이 씀(개발, 문서 작성, 조사, 설치·설정 등)

## 수동 호출 명령어

- `/progress`: 패널 열기·닫기
- `/progress clear`: 이 창의 진행 목록 지우기

## 기능

- 단계 표시: ✓ 완료 · ▶ 진행 중 · · 대기 · ⚠ 막힘(이유 한 줄) · – 건너뜀
- 묶음 아래에 단계 한 층까지 표시
- 전체 진행률 막대와 단계별 걸린 시간
- 알림: 단계가 끝나거나 막히거나 모든 단계가 끝나면 입력창 바로 위에 색 테두리 상자로 5초 동안 표시(완료는 초록, 막힘은 노랑)
- 실행 중 목록: 지금 1초 넘게 돌고 있는 명령을 `- 하는 일` 모양으로 패널 아래에 표시
- 목록 저장: 폴더·창별로 저장. 다시 켜면 같은 대화의 목록을, 없으면 같은 폴더에서 꺼진 창의 최근 목록을 이어받음. `/resume`으로 다른 대화로 돌아가면 그 대화의 목록으로 바뀜
- 패널이 저절로 열리는 때: Claude가 새 단계 목록을 적을 때, 창을 켤 때 이어받은 목록이 아직 안 끝났을 때
- 화면 폭
  - 터미널 전체 화면 레이아웃에서 110칸 이상이면 오른쪽에 붙고, 그 밖에는 입력창 위에 뜸
  - 저절로 열리는 것은 144칸 이상일 때만. 좁으면 `/progress`로 직접 열기

## 설치 방법

- Claude Code 입력창에서:

  ```
  /plugin install progress-panel --marketplace tmdekd/cc-progress-panel
  ```

  - `Add marketplace?`에 `y`
  - 설치 범위는 user를 고르고 Enter
  - `Installed progress-panel. Plugin is now active.`가 뜨면 끝. 그 창부터 바로 동작

- 셸에서:

  ```
  claude plugin install progress-panel --marketplace tmdekd/cc-progress-panel
  ```

- 데스크톱 앱에서: 입력창 옆 + → Plugins → Add marketplace에 `tmdekd/cc-progress-panel` 입력 → Add plugin
