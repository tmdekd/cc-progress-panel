import { expect, mock, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'

import type { Board, BoardEntry } from '../types'

const TOOL = 'mcp__progress-panel__progress'
const ROOT = 'C:\\Users\\me\\Proj'
const ROOT_KEY = 'c:/users/me/proj'
const T0 = Date.UTC(2026, 10, 18, 1, 0, 0)
const SEC = 1000
const MIN = 60 * SEC

// 이 mod 의 도구는 아직 타입에 없어서 입력을 넓게 받는다.
type CallInput = Parameters<EngineInterface['tool']['call']>[0]
const tool = (args: Record<string, unknown>) => ({ tool: TOOL, ...args }) as unknown as CallInput
const COMPOSER = { wait: false, origin: { kind: 'composer' } } as const
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const PLAN = {
  action: 'plan',
  title: '동네 빵집 홈페이지 만들기',
  steps: [
    { id: 'a', label: '사진 모으기' },
    {
      id: 'b',
      label: '화면',
      children: [
        { id: 'b1', label: '메뉴 화면' },
        { id: 'b2', label: '주문 화면' },
      ],
    },
    { id: 'c', label: '공개하기' },
  ],
}

const SURFACES = ['terminal', 'desktop'] as const

function pane(surface: 'terminal' | 'desktop', bodyColumns = 40, bodyRows = 40) {
  return {
    plugin: 'progress-panel',
    surface,
    component: 'Pane',
    requestId: 'progress',
    props: {
      title: '진행 상황',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows },
      view: {},
    },
  } as const
}

// 입력창 바로 위 띠. 알림 상자가 여기에 그려진다.
function band(surface: 'terminal' | 'desktop', o: { hasSurvey?: boolean; bodyColumns?: number } = {}) {
  return {
    plugin: 'progress-panel',
    surface,
    component: 'AbovePrompt',
    props: {
      hasSurvey: o.hasSurvey ?? false,
      isCollapsed: false,
      isWorking: true,
      maxRows: 20,
      bodyColumns: o.bodyColumns ?? 100,
      scroll: { offset: 0, bodyRows: 19 },
      view: {},
    },
  } as const
}

function savedBoard(title: string, done: boolean): Board {
  const status = done ? 'done' : 'todo'
  return {
    title,
    updatedAt: T0 - 20 * MIN,
    steps: [
      { id: 'x', label: '첫 단계', status: 'done' },
      { id: 'y', label: '둘째 단계', status },
    ],
  }
}

function entry(sessionId: string, lastSeen: number, board: Board, root = ROOT_KEY): BoardEntry {
  return { root, sessionId, lastSeen, board }
}

// 엔진 자리에 서는 훅들: 세션 id·루트, 저장소, 시계, 패널 열기·닫기, 토스트.
function world(on: On, o: { sessionId?: string; store?: Record<string, unknown> } = {}) {
  const store = new Map<string, unknown>(Object.entries(o.store ?? {}))
  const toasts: string[] = []
  const opened: string[] = []
  const clock = mock.clock(on, { now: T0 })

  on('session.id', () => ({ value: o.sessionId ?? 'S1' }))
  on('session.root', () => ({ value: ROOT }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__progress-panel__${e.name}` } }))
  const commands: { name: string; description: string }[] = []
  on('command.register', (_, e) => {
    commands.push({ name: e.name, description: e.description })
    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  return { store, toasts, opened, clock, commands }
}

const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const

// 화면 폭: 한글·전각은 2칸.
function cells(text: string): number {
  let n = 0
  for (const ch of text) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1
  return n
}

test('plan draws every step with its mark and the count, on terminal and desktop', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))

  expect(w.opened).toContain('progress')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ type: 'Text', text: /동네 빵집 홈페이지 만들기/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶ 사진 모으기/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /· 화면/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /· 메뉴 화면/ })).toBeDefined()
    // 완료 수 뒤에는 전체 걸린 시간만 붙는다.
    expect(await ui.find({ type: 'Text', text: /^0\/4 완료 · 방금 시작\s*$/ })).toBeDefined()
    // 막대 옆에 같은 숫자(0/4)나 퍼센트를 한 번 더 그리지 않는다.
    expect(await ui.find({ type: 'Text', text: /^0\/4$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /%/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a finished step shows how long it took and raises a green box above the prompt', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(42 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /✓ 사진 모으기.*42분/ })).toBeDefined()
  await ui.unmount()

  for (const surface of SURFACES) {
    const b = await $.ui.mount(band(surface))
    expect(await b.find({ type: 'Text', text: /^✓ 사진 모으기 완료 \(42분 걸림\)$/ })).toBeDefined()
    const box = await b.find({ type: 'Box', key: 'alert' })
    expect(box?.props.borderStyle).toBe('round')
    expect(box?.props.borderColor).toBe('success')
    await b.unmount()
  }
  // 눈에 잘 안 띄는 기본 알림창은 더 쓰지 않는다.
  expect(w.toasts).toEqual([])
})

test('the box above the prompt goes after 5 seconds', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))

  await w.clock.advance(4 * SEC)
  let b = await $.ui.mount(band('terminal'))
  expect(await b.find({ type: 'Text', text: /사진 모으기 완료/ })).toBeDefined()
  await b.unmount()

  await w.clock.advance(2 * SEC)
  b = await $.ui.mount(band('terminal'))
  expect(await b.find({ type: 'Text', text: /사진 모으기 완료/ })).toBeUndefined()
  expect(await b.find({ type: 'Box', key: 'alert' })).toBeUndefined()
  await b.unmount()
})

test('several alerts share one box, newest last, each going on its own time', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await w.clock.advance(3 * SEC)
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'done' }))

  let b = await $.ui.mount(band('terminal'))
  const lines = await b.findAll({ type: 'Text', text: /완료/ })
  expect(lines.map(l => l.text)).toEqual(['✓ 사진 모으기 완료', '✓ 메뉴 화면 완료'])
  await b.unmount()

  await w.clock.advance(3 * SEC)
  b = await $.ui.mount(band('terminal'))
  expect(await b.find({ type: 'Text', text: /사진 모으기 완료/ })).toBeUndefined()
  expect(await b.find({ type: 'Text', text: /메뉴 화면 완료/ })).toBeDefined()
  await b.unmount()
})

test('a survey above the prompt keeps the box away', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))

  const b = await $.ui.mount(band('terminal', { hasSurvey: true }))
  expect(await b.find({ type: 'Box', key: 'alert' })).toBeUndefined()
  await b.unmount()
})

test('a long alert is cut to the width above the prompt', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'blocked', note: '아주 '.repeat(40) }))

  const b = await $.ui.mount(band('terminal', { bodyColumns: 40 }))
  const line = await b.find({ type: 'Text', text: /공개하기에서 막힘/ })
  // 테두리 두 칸과 좌우 여백 두 칸을 뺀 폭.
  expect(cells(line?.text ?? '')).toBeLessThanOrEqual(36)
  expect(line?.text.endsWith('…')).toBe(true)
  await b.unmount()
})

test('a step in progress shows its time so far', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(17 * MIN)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /▶ 사진 모으기.*17분째/ })).toBeDefined()
  await ui.unmount()
})

test('the count is of the lowest steps', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'done' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /2\/4 완료/ })).toBeDefined()
  await ui.unmount()
})

test('a group follows the steps under it', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'b2', status: 'doing' }))

  let ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /▶ 화면/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call(tool({ action: 'update', id: 'b2', status: 'done' }))
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /✓ 화면/ })).toBeDefined()
  await ui.unmount()
})

test('a blocked step shows its reason and raises a yellow box above the prompt', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  const r = await $.tool.call(tool({ action: 'update', id: 'c', status: 'blocked', note: '도메인 연결 안 됨' }))
  // 도구 결과 글은 막힌 이유를 줄표 없이 괄호로 붙인다.
  expect(String(r.result)).toMatch(/공개하기 \(도메인 연결 안 됨\)/)
  expect(String(r.result)).not.toMatch(/—/)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /⚠ 공개하기/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /도메인 연결 안 됨/ })).toBeDefined()
  await ui.unmount()

  const b = await $.ui.mount(band('terminal'))
  const line = await b.find({ type: 'Text', text: /^⚠ 공개하기에서 막힘: 도메인 연결 안 됨$/ })
  expect(line?.props.color).toBe('warning')
  expect((await b.find({ type: 'Box', key: 'alert' }))?.props.borderColor).toBe('warning')
  await b.unmount()
})

test('finishing the last step says that all are done', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  for (const id of ['a', 'b1', 'b2']) {
    await $.tool.call(tool({ action: 'update', id, status: 'done' }))
  }
  let b = await $.ui.mount(band('terminal'))
  expect(await b.find({ type: 'Text', text: /모든 단계 완료/ })).toBeUndefined()
  await b.unmount()

  await $.tool.call(tool({ action: 'update', id: 'c', status: 'skipped' }))
  b = await $.ui.mount(band('terminal'))
  const all = await b.find({ type: 'Text', text: /^✓ 모든 단계 완료$/ })
  expect(all?.props.bold).toBe(true)
  await b.unmount()
})

// 다시 불러온 직후 session.start 보다 먼저 도구가 불려도 목록이 저장된다.
test('a list written before the session has started is still saved', async ($, on) => {
  const w = world(on)
  await $.tool.call(tool(PLAN))

  const saved = w.store.get(`board:${ROOT_KEY}:S1`) as BoardEntry | undefined
  expect(saved?.board.title).toBe('동네 빵집 홈페이지 만들기')
})

// 다시 불러오면 session.start 가 또 돈다. 이 세션이 이미 그리고 있는 목록을 저장소의 옛 목록으로 덮지 않는다.
test('a reload keeps the list the session already has over an older saved one', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  w.store.set(`board:${ROOT_KEY}:S1`, entry('S1', T0, savedBoard('옛 목록', false)))

  await $.session.start(START)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /동네 빵집 홈페이지 만들기/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /옛 목록/ })).toBeUndefined()
  await ui.unmount()
  const saved = w.store.get(`board:${ROOT_KEY}:S1`) as BoardEntry | undefined
  expect(saved?.board.title).toBe('동네 빵집 홈페이지 만들기')
})

// 같은 프로그램 안에서 세션이 바뀌면(/clear 등) 앞 세션이 그리던 목록을 들고 가지 않는다.
test('a new session does not carry the list the last one was drawing', async ($, on) => {
  const ids = { sessionId: 'S1' }
  world(on, ids)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  ids.sessionId = 'S2'
  await $.session.start(START)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /동네 빵집 홈페이지 만들기/ })).toBeUndefined()
  await ui.unmount()
})

// /resume 과 /clear 는 같은 프로그램 안에서 세션 id 만 바꾸고 session.start 는 부르지 않는다.
// 2026-11-18: 새 창(NEW)으로 켜서 지난 대화(OLD)의 목록을 이어받은 뒤 /resume 으로 OLD 에 돌아갔더니,
// 목록이 계속 NEW 이름으로 저장되다가 mod 를 다시 불러온 순간 사라졌다.
test('after /resume the list is kept under the session the window now is, and survives a reload', async ($, on) => {
  const ids: { sessionId: string; store: Record<string, unknown> } = {
    sessionId: 'NEW',
    store: { [`board:${ROOT_KEY}:OLD`]: entry('OLD', T0 - 10 * MIN, savedBoard('지난 작업', false)) },
  }
  const w = world(on, ids)
  await $.session.start(START)
  await $.session.end({ reason: 'resume', sessionId: 'NEW', resume: { id: 'NEW' } })
  ids.sessionId = 'OLD'

  await $.tool.call(tool(PLAN))
  const saved = w.store.get(`board:${ROOT_KEY}:OLD`) as BoardEntry | undefined
  expect(saved?.board.title).toBe('동네 빵집 홈페이지 만들기')

  await $.session.start(START) // mod 를 다시 불러옴
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /동네 빵집 홈페이지 만들기/ })).toBeDefined()
  await ui.unmount()
})

test('after /resume the window gets back the list it had, even with no prompt in between', async ($, on) => {
  const ids: { sessionId: string; store: Record<string, unknown> } = {
    sessionId: 'NEW',
    store: { [`board:${ROOT_KEY}:OLD`]: entry('OLD', T0 - 10 * MIN, savedBoard('지난 작업', false)) },
  }
  const w = world(on, ids)
  await $.session.start(START) // NEW 가 OLD 의 목록을 이어받는다
  await $.session.end({ reason: 'resume', sessionId: 'NEW', resume: { id: 'NEW' } })
  ids.sessionId = 'OLD'
  await w.clock.advance(2 * MIN) // 다음 살아 있음 표시까지

  expect((w.store.get(`board:${ROOT_KEY}:OLD`) as BoardEntry | undefined)?.board.title).toBe('지난 작업')
  expect(w.store.has(`board:${ROOT_KEY}:NEW`)).toBe(false)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /지난 작업/ })).toBeDefined()
  await ui.unmount()
})

test('after /resume to a conversation with its own list, that list is shown', async ($, on) => {
  const ids: { sessionId: string; store: Record<string, unknown> } = {
    sessionId: 'NEW',
    store: { [`board:${ROOT_KEY}:OLD`]: entry('OLD', T0 - 30 * SEC, savedBoard('그 대화의 작업', false)) },
  }
  const w = world(on, ids)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.session.end({ reason: 'resume', sessionId: 'NEW', resume: { id: 'NEW' } })
  ids.sessionId = 'OLD'

  const r = await $.tool.call(tool({ action: 'show' }))
  expect(String(r.result)).toMatch(/그 대화의 작업/)
  expect((w.store.get(`board:${ROOT_KEY}:NEW`) as BoardEntry | undefined)?.board.title).toBe('동네 빵집 홈페이지 만들기')
})

test('after /clear the new conversation does not show the last list', async ($, on) => {
  const ids: { sessionId: string } = { sessionId: 'S1' }
  const w = world(on, ids)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.session.end({ reason: 'clear', sessionId: 'S1', resume: { id: 'S1' } })
  ids.sessionId = 'S2'

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /동네 빵집 홈페이지 만들기/ })).toBeUndefined()
  await ui.unmount()
  await $.tool.call(tool({ action: 'plan', title: '새 일', steps: [{ id: 'n', label: '새 단계' }] }))
  expect((w.store.get(`board:${ROOT_KEY}:S2`) as BoardEntry | undefined)?.board.title).toBe('새 일')
  expect((w.store.get(`board:${ROOT_KEY}:S1`) as BoardEntry | undefined)?.board.title).toBe('동네 빵집 홈페이지 만들기')
})

test('planning the same work again keeps what was done', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(5 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ ...PLAN, steps: [...PLAN.steps, { id: 'd', label: '문서' }] }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /✓ 사진 모으기.*5분/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1\/5 완료/ })).toBeDefined()
  await ui.unmount()
})

// 다른 일(제목이 다름)의 단계가 우연히 같은 id 를 써도 지난 상태를 물려받지 않는다.
test('a new piece of work starts fresh even where ids repeat', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'plan', title: '다른 일', steps: [{ id: 'a', label: '시작' }, { id: 'z', label: '끝내기' }] }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /· 시작/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0\/2 완료/ })).toBeDefined()
  await ui.unmount()
})

test('an unknown step id is refused', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  const r = await $.tool.call(tool({ action: 'update', id: 'zz', status: 'done' }))

  expect(r.deny).toMatch(/zz/)
})

test('a subagent may not write the list', async ($, on) => {
  world(on)
  await $.session.start(START)
  const r = await $.tool.call(tool({ ...PLAN, agentId: 'a1' }))

  expect(r.deny).toMatch(/서브 에이전트/)
})

test('the tool answers with the list so Claude can read the ids', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  const r = await $.tool.call(tool({ action: 'show' }))

  expect(String(r.result)).toMatch(/동네 빵집 홈페이지 만들기/)
  expect(String(r.result)).toMatch(/b1/)
})

test('clear empties the panel and the saved list', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  expect(w.store.has(`board:${ROOT_KEY}:S1`)).toBe(true)
  await $.tool.call(tool({ action: 'clear' }))

  expect(w.store.has(`board:${ROOT_KEY}:S1`)).toBe(false)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /아직 진행 목록이 없습니다/ })).toBeDefined()
  await ui.unmount()
})

test('/progress clear does the same', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.command.run({ command: 'progress', args: 'clear', ...TYPED })

  expect(w.store.has(`board:${ROOT_KEY}:S1`)).toBe(false)
})

test('/progress opens the pane', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.command.run({ command: 'progress', args: '', ...TYPED })

  expect(w.opened).toContain('progress')
})

test('/progress describes itself in plain sentences', async ($, on) => {
  const w = world(on)
  await $.session.start(START)

  expect(w.commands.find(c => c.name === 'progress')?.description).toBe(
    '진행 상황 패널을 열거나 닫습니다. clear를 붙이면 목록을 지웁니다.',
  )
})

test('this session\'s saved list comes back and opens the pane', async ($, on) => {
  const w = world(on, {
    store: { [`board:${ROOT_KEY}:S1`]: entry('S1', T0 - 30 * MIN, savedBoard('지난 작업', false)) },
  })
  await $.session.start(START)

  expect(w.opened).toContain('progress')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /지난 작업/ })).toBeDefined()
  await ui.unmount()
})

test('the list of a closed window is taken over', async ($, on) => {
  const w = world(on, {
    sessionId: 'S2',
    store: { [`board:${ROOT_KEY}:OLD`]: entry('OLD', T0 - 10 * MIN, savedBoard('지난 작업', false)) },
  })
  await $.session.start(START)

  expect(w.store.has(`board:${ROOT_KEY}:S2`)).toBe(true)
  expect(w.store.has(`board:${ROOT_KEY}:OLD`)).toBe(false)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /지난 작업/ })).toBeDefined()
  await ui.unmount()
})

test('the list of a window still open is left alone', async ($, on) => {
  const w = world(on, {
    sessionId: 'S2',
    store: { [`board:${ROOT_KEY}:OLD`]: entry('OLD', T0 - 30 * SEC, savedBoard('다른 창 작업', false)) },
  })
  await $.session.start(START)

  expect(w.store.has(`board:${ROOT_KEY}:OLD`)).toBe(true)
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /다른 창 작업/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /아직 진행 목록이 없습니다/ })).toBeDefined()
  await ui.unmount()
})

test('another folder\'s list is not shown', async ($, on) => {
  world(on, {
    sessionId: 'S2',
    store: { 'board:c:/other:OLD': entry('OLD', T0 - 60 * MIN, savedBoard('다른 폴더', false), 'c:/other') },
  })
  await $.session.start(START)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /다른 폴더/ })).toBeUndefined()
  await ui.unmount()
})

test('a finished list comes back without opening the pane', async ($, on) => {
  const w = world(on, {
    store: { [`board:${ROOT_KEY}:S1`]: entry('S1', T0 - 30 * MIN, savedBoard('끝난 작업', true)) },
  })
  await $.session.start(START)

  expect(w.opened).not.toContain('progress')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /끝난 작업/ })).toBeDefined()
  await ui.unmount()
})

test('the window that holds a list keeps saying it is open', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await w.clock.advance(5 * MIN)

  const saved = w.store.get(`board:${ROOT_KEY}:S1`) as BoardEntry
  expect(saved.lastSeen).toBeGreaterThanOrEqual(T0 + 4 * MIN)
})

test('the first prompt after taking over a list tells Claude, once', async ($, on) => {
  world(on, {
    sessionId: 'S2',
    store: { [`board:${ROOT_KEY}:OLD`]: entry('OLD', T0 - 10 * MIN, savedBoard('지난 작업', false)) },
  })
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  await $.session.start(START)

  const first = await $.prompt.submit({ text: '이어서 하자', ...COMPOSER })
  expect((first.context ?? []).join('\n')).toMatch(/\[진행 상황 패널\].*지난 작업/s)
  const second = await $.prompt.submit({ text: '다음', ...COMPOSER })
  expect((second.context ?? []).join('\n')).not.toMatch(/진행 상황 패널/)
})

// 아래 칸은 "- 하는 일" 목록만: 머리말("실행 중:")과 걸린 시간은 없다.
test('the running command shows as a plain list item, and then goes', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  const call = $.tool.call({ tool: 'Bash', command: 'pytest test/db\necho done' })
  await w.clock.settle()
  await w.clock.advance(2500)

  let ui = await $.ui.mount(pane('terminal'))
  const line = await ui.find({ type: 'Text', text: /pytest test\/db/ })
  expect(line?.text).toBe('- pytest test/db')
  expect(await ui.find({ type: 'Text', text: /실행 중|초$/ })).toBeUndefined()
  await ui.unmount()

  await w.clock.advance(5 * SEC)
  await call
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /pytest/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /실행 중인 작업 없음/ })).toBeDefined()
  await ui.unmount()
})

// 경로가 긴 명령은 잘려서 무엇을 하는지 안 보인다. Claude가 적은 짧은 설명을 대신 보여 준다.
test('a command shows the short description Claude gave it', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  const call = $.tool.call({
    tool: 'Bash',
    command: 'cd "C:/Users/me/.claude/dev-mods/abc/progress-panel" && claude plugin test . 2>&1 | tail -4',
    description: '플러그인 테스트 실행',
  })
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal'))
  const line = await ui.find({ type: 'Text', text: /플러그인/ })
  expect(line?.text).toBe('- 플러그인 테스트 실행')
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await call
})

// 설명이 없으면 앞의 "cd 경로 &&"를 떼고, 첫 명령만(뒤의 |·&&·;·출력 돌리기 없이), 절대 경로는 마지막 이름만 남긴다.
test('without a description the command is shortened', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  const call = $.tool.call({
    tool: 'Bash',
    command: 'cd "C:/Users/me/Proj" && pytest C:/Users/me/Proj/tests/test_db.py 2>/dev/null',
  })
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal', 60))
  const line = await ui.find({ type: 'Text', text: /pytest/ })
  expect(line?.text).toBe('- pytest test_db.py')
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await call
})

test('a shortened command keeps only its first command', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  const examples: [string, string][] = [
    ['cd "C:/a/b" && claude plugin validate C:/Users/me/progress-panel 2>&1 | tail -1', '- claude plugin validate progress-panel'],
    ['npm run build && npm test', '- npm run build'],
    ['Start-Sleep -Seconds 8; "ok"', '- Start-Sleep -Seconds 8'],
    ['grep -n "a|b" file.txt > out.txt', '- grep -n "a|b" file.txt'],
  ]
  for (const [command, shown] of examples) {
    const call = $.tool.call({ tool: 'Bash', command })
    await w.clock.settle()
    await w.clock.advance(2500)
    const ui = await $.ui.mount(pane('terminal', 60))
    expect((await ui.find({ type: 'Text', text: /^- / }))?.text).toBe(shown)
    await ui.unmount()
    await w.clock.advance(5 * SEC)
    await call
  }
})

test('a subagent\'s commands are left out', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  const call = $.tool.call({ tool: 'Bash', command: 'make', agentId: 'a1' })
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /make/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /실행 중인 작업 없음/ })).toBeDefined()
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await call
})

// 백그라운드 명령도 같은 "- 하는 일" 모양이다.
test('a background command is listed the same way', async ($, on) => {
  const w = world(on)
  // 백그라운드로 띄운 명령은 바로 돌아오고, 끝은 나중에 알림으로 온다.
  on('tool.call', { tool: 'Bash' }, () => ({ result: { backgroundTaskId: 't1' } }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'docker compose up', description: '도커 컨테이너 시작', run_in_background: true })
  await w.clock.advance(2 * SEC)

  const ui = await $.ui.mount(pane('terminal'))
  const line = await ui.find({ type: 'Text', text: /도커/ })
  expect(line?.text).toBe('- 도커 컨테이너 시작')
  expect(await ui.find({ type: 'Text', text: /백그라운드/ })).toBeUndefined()
  await ui.unmount()
})

test('a long label is cut to the pane width', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '짧은 제목',
      steps: [{ id: 'a', label: '아주 긴 한국어 단계 이름입니다 정말로 아주 깁니다' }],
    }),
  )

  const ui = await $.ui.mount(pane('terminal', 24))
  const row = await ui.find({ type: 'Text', text: /· 아주/ })
  expect(row).toBeDefined()
  expect(cells(row?.text ?? '')).toBeLessThanOrEqual(24)
  expect(row?.text).toMatch(/…/)
  await ui.unmount()
})

test('the rules are added to the system prompt, last', async ($, on) => {
  world(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: '시작', scope: 'shared' }] }))
  await $.session.start(START)
  const r = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [TOOL],
    outputStyle: null,
    traits: [],
  })
  const last = r.sections[r.sections.length - 1]

  expect(last?.id).toBe('progress-panel:rules')
  expect(last?.scope).toBe('session')
  expect(last?.text).toMatch(/mcp__progress-panel__progress/)
  // 누가 어떤 일을 하든: 할 예정·하는 중·끝남·막힘을 알리고, 일의 종류를 가리지 않는다.
  expect(last?.text).toMatch(/할 예정/)
  expect(last?.text).toMatch(/종류와 상관없이/)
  // 하는 도중 할 일이 바뀌면 같은 제목으로 다시 적어 패널을 실제 진행에 맞춘다.
  expect(last?.text).toMatch(/같은 title로 다시 "plan"/)
  // 패널의 실행 중 줄이 읽히도록 명령 설명을 사용자가 쓰는 언어로 짧게 적게 한다(특정 언어로 못 박지 않는다).
  expect(last?.text).toMatch(/description.*사용자가 쓰는 언어/)
  expect(last?.text).not.toMatch(/한국어/)
  // 단계 이름과 명령 설명은 문법에 맞게, 명사로 끝나는 개조식으로('~하기' 없이), 한 줄에 한 가지 일만.
  expect(last?.text).toMatch(/문법에 맞는 자연스러운 말/)
  expect(last?.text).toMatch(/명사로 끝나는 짧은 개조식/)
  expect(last?.text).toMatch(/'~하기'.*끝내지 않는다/)
  expect(last?.text).toMatch(/두 가지 일을 한 줄에 이어 붙이지 않는다/)
})

// ── 가독성: 상태마다 색, 단계 사이 빈 줄 ─────────────────

test('the step in progress stands out in the accent color, on terminal and desktop', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const label = await ui.find({ type: 'Text', text: /^사진 모으기$/ })
    expect(label?.props.color).toBe('claude')
    expect(label?.props.bold).toBe(true)
    await ui.unmount()
  }
})

test('a finished step recedes and its mark is green', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^사진 모으기$/ }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^✓$/ }))?.props.color).toBe('success')
  await ui.unmount()
})

test('a blocked step and its reason are in the warning color', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'blocked', note: '도메인 연결 안 됨' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^공개하기$/ }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: /도메인 연결 안 됨/ }))?.props.color).toBe('warning')
  await ui.unmount()
})

test('a skipped step is struck through', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'skipped' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^공개하기$/ }))?.props.strikethrough).toBe(true)
  await ui.unmount()
})

test('a group\'s name is bold', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^화면$/ }))?.props.bold).toBe(true)
  await ui.unmount()
})

// 마지막 단계 묶음의 빈 줄이 실행 중 칸과의 간격도 맡는다(빈 줄 두 개가 되지 않게).
test('top-level steps are set apart by a blank row, and the head too', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))

  const ui = await $.ui.mount(pane('terminal'))
  for (const id of ['a', 'b']) {
    expect((await ui.find({ type: 'Box', key: `step-${id}` }))?.props.marginBottom).toBe(1)
  }
  // 예정은 셋(사진 모으기, 메뉴 화면, 주문 화면)까지만. 넷째(공개하기)는 개수로 적는다.
  expect(await ui.find({ type: 'Box', key: 'step-c' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^· 예정 1개 더$/ }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Box', key: 'head' }))?.props.marginBottom).toBe(1)
  expect((await ui.find({ type: 'Box', key: 'calls' }))?.props.marginTop).toBeUndefined()
  await ui.unmount()
})

test('the empty panel keeps a blank row before the running part', async ($, on) => {
  world(on)
  await $.session.start(START)

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Box', key: 'empty' }))?.props.marginBottom).toBe(1)
  await ui.unmount()
})

test('the list mark of a running command is in its own color', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  const call = $.tool.call({ tool: 'Bash', command: 'pytest test/db' })
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^-$/ }))?.props.color).toBe('suggestion')
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await call
})

// ── 2026-11-19 손질: 시간·도구 이름·실행 중 칸·도구 결과 글 ─────────

// 진행 중 시간은 30초마다만 다시 그려져 "0초째"로 멈춰 보였다. 1분 전까지는 "방금 시작"으로 적는다.
test('a step just started says so instead of counting seconds', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(30 * SEC)

  let ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /▶ 사진 모으기.*방금 시작$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /초째/ })).toBeUndefined()
  await ui.unmount()

  await w.clock.advance(30 * SEC)
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing' }))
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /▶ 사진 모으기.*1분째$/ })).toBeDefined()
  // 묶음도 아래 단계의 시작 시각을 따른다.
  expect(await ui.find({ type: 'Text', text: /▶ 화면.*방금 시작$/ })).toBeDefined()
  await ui.unmount()
})

// 오래 걸리는 도구를 흉내 낸다: 5초 동안 끝나지 않는다.
function slow(on: On, w: ReturnType<typeof world>, name: string) {
  on('tool.call', { tool: name } as Parameters<On>[1] & object, async () => {
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
}

test('tools show plain names: MCP by its tool name, web and skill tools in words', async ($, on) => {
  const w = world(on)
  const MEM = 'mcp__plugin_claude-mem_mcp-search__work_state_write'
  for (const name of [MEM, 'WebSearch', 'WebFetch', 'Skill']) slow(on, w, name)
  await $.session.start(START)
  const calls = [
    $.tool.call({ tool: MEM, list: 'x' } as unknown as CallInput),
    $.tool.call({ tool: 'WebSearch', query: '빵집' } as unknown as CallInput),
    $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: '요약' } as unknown as CallInput),
    $.tool.call({ tool: 'Skill', skill: 'plugin-authoring' } as unknown as CallInput),
  ]
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal'))
  const lines = (await ui.findAll({ type: 'Text', text: /^- / })).map(l => l.text)
  expect(lines).toEqual(['- work_state_write', '- 웹 검색: 빵집', '- 웹 페이지: example.com', '- 스킬: plugin-authoring'])
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('the running part shows at most five calls and counts the rest', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await $.session.start(START)
  const calls = [1, 2, 3, 4, 5, 6, 7].map(n =>
    $.tool.call({ tool: 'Bash', command: `job ${n}`, description: `작업${n}` } as unknown as CallInput),
  )
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Text', text: /^- / })).toHaveLength(5)
  expect(await ui.find({ type: 'Text', text: /작업6/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^외 2개$/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

// ── 2026-11-24 손질: "- Read"만 보여서는 무엇을 보는지 알 수 없다 ─────────
// 파일·검색 도구는 "종류: 대상"으로 보인다. 경로는 파일 이름만 남긴다.
test('file and search tools show what they touch', async ($, on) => {
  const w = world(on)
  for (const name of ['Read', 'Edit', 'Write', 'Grep', 'Glob']) slow(on, w, name)
  await $.session.start(START)
  const calls = [
    $.tool.call({ tool: 'Read', file_path: 'C:\\Users\\me\\Proj\\viz\\api\\chat.py' } as unknown as CallInput),
    $.tool.call({ tool: 'Edit', file_path: 'C:/Users/me/Proj/ai/agent.py', old_string: 'a', new_string: 'b' } as unknown as CallInput),
    $.tool.call({ tool: 'Write', file_path: '/home/me/notes.md', content: 'x' } as unknown as CallInput),
    $.tool.call({ tool: 'Grep', pattern: 'SESSION_RE' } as unknown as CallInput),
    $.tool.call({ tool: 'Glob', pattern: '**/*.py' } as unknown as CallInput),
  ]
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal'))
  const lines = (await ui.findAll({ type: 'Text', text: /^- / })).map(l => l.text)
  expect(lines).toEqual([
    '- 파일 읽기: chat.py',
    '- 파일 수정: agent.py',
    '- 파일 작성: notes.md',
    '- 코드 검색: "SESSION_RE"',
    '- 파일 찾기: **/*.py',
  ])
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

// 같은 종류는 한 줄에 모은다. 줄 순서는 그 종류가 처음 시작한 차례, 이름 순서는 시작한 차례.
test('calls of one kind share a line, and a narrow pane counts the names that do not fit', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Read')
  slow(on, w, 'Grep')
  await $.session.start(START)
  const read = (f: string) => $.tool.call({ tool: 'Read', file_path: `C:/Users/me/Proj/db/${f}` } as unknown as CallInput)
  const calls = [
    read('load.py'),
    $.tool.call({ tool: 'Grep', pattern: 'x' } as unknown as CallInput),
    read('chat.py'),
    read('app.py'),
    read('runs.py'),
    read('store.py'),
  ]
  await w.clock.settle()
  await w.clock.advance(2500)

  let ui = await $.ui.mount(pane('terminal', 80))
  let lines = (await ui.findAll({ type: 'Text', text: /^- / })).map(l => l.text)
  expect(lines).toEqual(['- 파일 읽기: load.py, chat.py, app.py, runs.py, store.py', '- 코드 검색: "x"'])
  await ui.unmount()

  ui = await $.ui.mount(pane('terminal', 40))
  lines = (await ui.findAll({ type: 'Text', text: /^- / })).map(l => l.text)
  expect(lines).toEqual(['- 파일 읽기: load.py, chat.py 외 3개', '- 코드 검색: "x"'])
  expect(await ui.find({ type: 'Text', text: /^외 \d+개$/ })).toBeUndefined()
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('a file read twice at once is named once', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Read')
  await $.session.start(START)
  const calls = [1, 2].map(() =>
    $.tool.call({ tool: 'Read', file_path: 'C:/Users/me/Proj/db/load.py' } as unknown as CallInput),
  )
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal'))
  const lines = (await ui.findAll({ type: 'Text', text: /^- / })).map(l => l.text)
  expect(lines).toEqual(['- 파일 읽기: load.py'])
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

// 도구 결과 글도 패널과 같은 말("n/m 완료")을 쓴다.
test('the tool answer counts what is finished in the panel\'s words', async ($, on) => {
  world(on)
  await $.session.start(START)
  const r = await $.tool.call(tool(PLAN))
  expect(String(r.result)).toMatch(/\(0\/4 완료\)/)
  expect(String(r.result)).not.toMatch(/단계\)/)
})

// 끝난 묶음은 끝난 단계처럼 물러난다(굵게 하지 않는다).
test('a finished group is not bold', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'b2', status: 'done' }))

  const ui = await $.ui.mount(pane('terminal'))
  const name = await ui.find({ type: 'Text', text: /^화면$/ })
  expect(name?.props.dimColor).toBe(true)
  expect(name?.props.bold).not.toBe(true)
  await ui.unmount()
})

// ── 전체 걸린 시간: 진행률 옆에 ─────────────────────────

test('the head shows how long the whole work has taken so far', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))

  // 아직 아무것도 시작하지 않았으면 시간은 없다.
  let ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /^0\/4 완료\s*$/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(72 * MIN)
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /^0\/4 완료 · 1시간 12분째\s*$/ })).toBeDefined()
  await ui.unmount()
})

test('when all is finished the head keeps the whole time, start to last end', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(125 * MIN)
  for (const id of ['a', 'b1', 'b2']) await $.tool.call(tool({ action: 'update', id, status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'skipped' }))

  let ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /^4\/4 완료 · 2시간 5분\s*$/ })).toBeDefined()
  await ui.unmount()

  // 다 끝난 뒤에는 시간이 더 늘지 않는다.
  await w.clock.advance(10 * MIN)
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /^4\/4 완료 · 2시간 5분\s*$/ })).toBeDefined()
  await ui.unmount()
})

// ── 짧게 보기: 끝난 것은 최근 1개, 예정은 3개까지, 높이에 맞춰 줄이기 ──────

const LONG = {
  action: 'plan',
  title: '안내서 만들기',
  steps: [
    { id: 's1', label: '자료 수집' },
    { id: 's2', label: '목차 구성' },
    { id: 's3', label: '초안 작성' },
    { id: 's4', label: '그림 삽입' },
    { id: 's5', label: '맞춤법 검사' },
    { id: 's6', label: '검토 요청' },
    { id: 's7', label: '수정 반영' },
    { id: 's8', label: '게시' },
  ],
}

type Kit = Parameters<Parameters<typeof test>[1]>[0]

// s1 끝 → 1분 뒤 s2 끝 → s3 진행 중. 지금은 시작에서 2분 뒤.
async function longUnderway($: Kit, w: ReturnType<typeof world>) {
  await $.session.start(START)
  await $.tool.call(tool(LONG))
  await $.tool.call(tool({ action: 'update', id: 's1', status: 'doing' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 's1', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 's2', status: 'doing' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 's2', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 's3', status: 'doing' }))
}

// 각 글자 모양이 그려진 Text 가운데 하나라도 있는지.
async function texts(ui: { findAll: (q: { type: 'Text' }) => Promise<{ text: string }[]> }, ...want: RegExp[]) {
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  return want.map(re => all.some(t => re.test(t)))
}

test('a long list shows the last finished step, every step underway and the next three', async ($, on) => {
  const w = world(on)
  await longUnderway($, w)

  // 머리 4 + 단계 7줄 + 빈 줄 5 + 실행 중 칸 2 = 18줄. 40줄에 들어간다.
  const ui = await $.ui.mount(pane('terminal', 40, 40))
  expect(
    await texts(ui, /^✓ 완료 1개 더$/, /✓ 목차 구성/, /▶ 초안 작성/, /· 그림 삽입/, /· 맞춤법 검사/, /· 검토 요청/, /^· 예정 2개 더$/),
  ).toEqual([true, true, true, true, true, true, true])
  expect(await texts(ui, /자료 수집/, /수정 반영/, /게시/)).toEqual([false, false, false])
  expect(await ui.find({ type: 'Text', text: /^2\/8 완료 · 2분째\s*$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^✓ 완료 1개 더$/ }))?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^· 예정 2개 더$/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('the finished step kept is the one that ended last, not the last in order', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(LONG))
  await $.tool.call(tool({ action: 'update', id: 's2', status: 'doing' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 's2', status: 'done' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 's1', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 's3', status: 'doing' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await texts(ui, /✓ 자료 수집/, /목차 구성/)).toEqual([true, false])
  await ui.unmount()
})

test('a shorter pane shows fewer upcoming steps so nothing scrolls', async ($, on) => {
  const w = world(on)
  await longUnderway($, w)

  // 예정 3개는 18줄, 2개는 16줄, 1개는 14줄. 15줄이면 1개.
  const ui = await $.ui.mount(pane('terminal', 40, 15))
  expect(await texts(ui, /^✓ 완료 1개 더$/, /✓ 목차 구성/, /▶ 초안 작성/, /· 그림 삽입/, /^· 예정 4개 더$/)).toEqual([
    true,
    true,
    true,
    true,
    true,
  ])
  expect(await texts(ui, /맞춤법 검사/, /검토 요청/)).toEqual([false, false])
  await ui.unmount()
})

test('a very short pane drops the finished step, then the blank rows, never a step underway', async ($, on) => {
  const w = world(on)
  await longUnderway($, w)
  await $.tool.call(tool({ action: 'update', id: 's4', status: 'doing' }))

  // 진행 중 둘. 예정 1개·완료 빼기 14줄, 예정 0개 12줄, 빈 줄까지 빼면 11줄.
  let ui = await $.ui.mount(pane('terminal', 40, 11))
  expect(await texts(ui, /^✓ 완료 2개 더$/, /▶ 초안 작성/, /▶ 그림 삽입/, /^· 예정 4개 더$/)).toEqual([true, true, true, true])
  expect(await texts(ui, /목차 구성/, /맞춤법 검사/)).toEqual([false, false])
  expect((await ui.find({ type: 'Box', key: 'step-s3' }))?.props.marginBottom).toBe(0)
  // 마지막 묶음의 빈 줄은 실행 중 칸과의 간격이라 남긴다.
  expect((await ui.find({ type: 'Box', key: 'step-s4' }))?.props.marginBottom).toBe(1)
  await ui.unmount()

  // 무엇으로도 모자라면 가장 짧은 모양으로 그리되 진행 중 단계는 남는다.
  ui = await $.ui.mount(pane('terminal', 40, 5))
  expect(await texts(ui, /▶ 초안 작성/, /▶ 그림 삽입/)).toEqual([true, true])
  await ui.unmount()
})

test('a group with none of its steps shown is left out', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '발표 준비',
      steps: [
        { id: 'a', label: '준비' },
        { id: 'b', label: '자료 조사' },
        { id: 'c', label: '내용 정리' },
        { id: 'd', label: '요약' },
        {
          id: 'g',
          label: '발표',
          children: [
            { id: 'g1', label: '슬라이드' },
            { id: 'g2', label: '리허설' },
          ],
        },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await texts(ui, /^· 예정 2개 더$/, /^발표$/, /슬라이드/)).toEqual([true, false, false])
  expect(await ui.find({ type: 'Box', key: 'step-g' })).toBeUndefined()
  await ui.unmount()
})

test('a group shows only the steps of it that are shown', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'done' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'b2', status: 'done' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await texts(ui, /^✓ 완료 2개 더$/, /✓ 화면/, /✓ 주문 화면/, /· 공개하기/)).toEqual([true, true, true, true])
  expect(await texts(ui, /메뉴 화면/)).toEqual([false])
  await ui.unmount()
})

// ── 멈춘 시간 빼기: Claude가 쉬는 동안(일이 끝나고 다음 입력까지, 질문·승인 창이 뜬 동안)은 세지 않는다 ──

const turnStart = ($: Kit) => $.turn.start({ text: '', turnId: 'turn' })
const turnEnd = ($: Kit) =>
  $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'turn', reason: 'answer' })

test('time while Claude rests between turns is not counted', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await turnStart($)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(5 * MIN)
  await turnEnd($)
  await w.clock.advance(30 * MIN)

  // 쉬는 동안 시간은 그 자리에 멈춘다.
  let ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /▶ 사진 모으기.*5분째$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^0\/4 완료 · 5분째\s*$/ })).toBeDefined()
  await ui.unmount()

  await turnStart($)
  await w.clock.advance(5 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /✓ 사진 모으기.*10분$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1\/4 완료 · 10분째\s*$/ })).toBeDefined()
  await ui.unmount()
  const b = await $.ui.mount(band('terminal'))
  expect(await b.find({ type: 'Text', text: /^✓ 사진 모으기 완료 \(10분 걸림\)$/ })).toBeDefined()
  await b.unmount()
})

test('time waiting on a question or a plan approval is not counted', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'AskUserQuestion' } as Parameters<On>[1] & object, async () => {
    await w.clock.sleep(1 * MIN)
    return { result: {} }
  })
  on('tool.call', { tool: 'ExitPlanMode' } as Parameters<On>[1] & object, async () => {
    await w.clock.sleep(1 * MIN)
    return { result: {} }
  })
  await $.session.start(START)
  await turnStart($)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(2 * MIN)

  let call = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as unknown as CallInput)
  await w.clock.settle()
  await w.clock.advance(1 * MIN)
  await call
  await w.clock.advance(3 * MIN)
  call = $.tool.call({ tool: 'ExitPlanMode' } as unknown as CallInput)
  await w.clock.settle()
  await w.clock.advance(1 * MIN)
  await call

  // 일한 시간은 질문 전 2분과 질문·승인 사이 3분뿐이다.

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /▶ 사진 모으기.*5분째$/ })).toBeDefined()
  await ui.unmount()
})

test('a list taken over from a closed window does not count the time it was closed', async ($, on) => {
  // 꺼진 창은 5분 일하고 쉬다가(55분 전) 꺼졌다.
  const old: Board = {
    title: '지난 작업',
    updatedAt: T0 - 55 * MIN,
    pausedSince: T0 - 55 * MIN,
    steps: [
      { id: 'x', label: '첫 단계', status: 'doing', startedAt: T0 - 60 * MIN },
      { id: 'y', label: '둘째 단계', status: 'todo' },
    ],
  }
  const w = world(on, { sessionId: 'S2', store: { [`board:${ROOT_KEY}:OLD`]: entry('OLD', T0 - 55 * MIN, old) } })
  await $.session.start(START)

  let ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /▶ 첫 단계.*5분째$/ })).toBeDefined()
  await ui.unmount()

  await turnStart($)
  await w.clock.advance(2 * MIN)
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /▶ 첫 단계.*7분째$/ })).toBeDefined()
  await ui.unmount()
})
