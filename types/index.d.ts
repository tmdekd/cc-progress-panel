// progress-panel 의 상태 계약.
// 저장소($.store) 키는 `board:<프로젝트 루트(소문자, / 구분)>:<세션 id>` 이고 값은 BoardEntry 다.

export type StepStatus = 'todo' | 'doing' | 'done' | 'blocked' | 'skipped'

export type Step = {
  id: string
  label: string
  status: StepStatus
  note?: string
  startedAt?: number
  endedAt?: number
  // 마지막으로 진행 중이 된 시각(일한 시각). 막혔다가 다시 진행 중이 되면 새로 적는다. startedAt 은 처음 시작한 때 그대로다.
  // 돌고 있는 명령은 이 값이 가장 큰 진행 중 단계 아래에 붙는다. 없어도 되는 칸이라 모양 태그를 올리지 않는다.
  doingSince?: number
  children?: Step[]
}

export type Board = {
  title: string
  steps: Step[]
  updatedAt: number
  // Claude가 쉰 시간(ms)의 합과, 지금 쉬고 있으면 쉬기 시작한 시각. 단계의 startedAt·endedAt 은
  // 벽시계에서 쉰 시간을 뺀 '일한 시각'이라, 둘의 차가 곧 일한 시간이다.
  // 둘 다 없어도 되는 칸이라 옛 값도 그대로 읽힌다(모양 태그를 올리지 않는다).
  paused?: number
  pausedSince?: number
}

export type BoardEntry = {
  root: string
  sessionId: string
  lastSeen: number
  board: Board
}

export type Running = {
  id: string
  label: string
  // 파일·검색 도구의 종류(예: '읽기')와 대상(예: 'db/chat.py:1-40'). 패널은 "▶ 종류 대상"으로 한 줄씩 그리고,
  // 좁으면 대상만 줄인다. 없어도 되는 칸이라 옛 값도 그대로 읽힌다(모양 태그를 올리지 않는다).
  kind?: string
  target?: string
  startedAt: number
  isBackground: boolean
  taskId?: string
}

// 입력창 바로 위에 잠깐 뜨는 알림 한 줄. at 부터 5초 동안 보인다.
export type AlertKind = 'done' | 'blocked' | 'all'

export type Alert = {
  id: number
  kind: AlertKind
  text: string
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'progress-panel': {
      board: Shaped<Board | null>
      running: Shaped<Running[]>
      alerts: Shaped<Alert[]>
      now: number
      // $.state 의 목록이 어느 세션(id) 것인지.
      owner: string
    }
  }
}
