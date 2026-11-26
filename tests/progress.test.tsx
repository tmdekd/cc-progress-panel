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

// 화면 폭: 한글·전각·이모지는 2칸, 이모지 이음 글자는 0칸. 1칸 글자 뒤의 U+FE0F는 그 글자를 2칸으로 만든다.
function cells(text: string): number {
  let n = 0
  let prev = ''
  for (const ch of text) {
    const before = prev
    prev = ch
    if (ch === '\ufe0f' && before && cells(before) === 1) n += 1
    if (/[\ufe0f\u200d\u20e3]/.test(ch)) continue
    if (/\p{Emoji_Presentation}/u.test(ch)) n += 1
    n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1
  }
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
    expect(await ui.find({ type: 'Text', text: /◉ 사진 모으기/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /○ 화면/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /├─○ 메뉴 화면/ })).toBeDefined()
    // 머리 둘째 줄: 가는 막대, 완료 수/전체, 전체 걸린 시간. 퍼센트는 그리지 않는다.
    expect(await ui.find({ type: 'Text', text: /^─+ 0\/4 · 방금 시작$/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /● 사진 모으기.*42분/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /◉ 사진 모으기.*17분째/ })).toBeDefined()
  await ui.unmount()
})

test('the count is of the lowest steps', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'done' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: / 2\/4( · |$)/ })).toBeDefined()
  await ui.unmount()
})

test('a group follows the steps under it', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'b2', status: 'doing' }))

  let ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /◉ 화면/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call(tool({ action: 'update', id: 'b2', status: 'done' }))
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /● 화면/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /▲ 공개하기/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^┆ 도메인 연결 안 됨$/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /● 사진 모으기.*5분/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / 1\/5( · |$)/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /○ 시작/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / 0\/2( · |$)/ })).toBeDefined()
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
  expect(line?.text).toBe('┆ ▶ pytest test/db')
  expect(await ui.find({ type: 'Text', text: /실행 중|초$/ })).toBeUndefined()
  await ui.unmount()

  await w.clock.advance(5 * SEC)
  await call
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /pytest/ })).toBeUndefined()
  expect(await ui.find({ type: 'Box', key: 'calls' })).toBeUndefined()
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
  expect(line?.text).toBe('┆ ▶ 플러그인 테스트 실행')
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
  expect(line?.text).toBe('┆ ▶ pytest test_db.py')
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
    ['cd "C:/a/b" && claude plugin validate C:/Users/me/progress-panel 2>&1 | tail -1', '┆ ▶ claude plugin validate progress-panel'],
    ['npm run build && npm test', '┆ ▶ npm run build'],
    ['Start-Sleep -Seconds 8; "ok"', '┆ ▶ Start-Sleep -Seconds 8'],
    ['grep -n "a|b" file.txt > out.txt', '┆ ▶ grep -n "a|b" file.txt'],
  ]
  for (const [command, shown] of examples) {
    const call = $.tool.call({ tool: 'Bash', command })
    await w.clock.settle()
    await w.clock.advance(2500)
    const ui = await $.ui.mount(pane('terminal', 60))
    expect((await ui.find({ type: 'Text', text: /^┆ / }))?.text).toBe(shown)
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
  expect(await ui.find({ type: 'Box', key: 'calls' })).toBeUndefined()
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await call
})

// 백그라운드 명령도 같은 "- 하는 일" 모양이다.
// 2026-11-26 사용자가 정함: 패널은 단계만 보이면 되므로 백그라운드 작업은 그리지 않는다(시간 세기에만 쓴다).
test('a background command is not drawn', async ($, on) => {
  const w = world(on)
  // 백그라운드로 띄운 명령은 바로 돌아오고, 끝은 나중에 알림으로 온다.
  on('tool.call', { tool: 'Bash' }, () => ({ result: { backgroundTaskId: 't1' } }))
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'docker compose up', description: '도커 컨테이너 시작', run_in_background: true })
  await w.clock.advance(2 * SEC)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /도커/ })).toBeUndefined()
  expect(await ui.find({ type: 'Box', key: 'calls' })).toBeUndefined()
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
  const row = await ui.find({ type: 'Text', text: /○ 아주/ })
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
  // 명령은 진행 중 단계 아래에 보인다(2026-11-24).
  expect(last?.text).toMatch(/진행 중 단계 아래/)
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
  expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe('success')
  await ui.unmount()
})

test('a blocked step and its reason are in the warning color', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'blocked', note: '도메인 연결 안 됨' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^공개하기$/ }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: /^도메인 연결 안 됨$/ }))?.props.color).toBe('warning')
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

// 맨 위 단계 사이 빈 줄은 세로선 한 줄로 바뀌었다(2026-11-24). 머리 아래 빈 줄은 그대로.
test('top-level steps are joined by a rail row, and the head keeps a blank row', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))

  const ui = await $.ui.mount(pane('terminal'))
  // 세로선 줄 2(사진 모으기→화면, 화면→공개하기) + 묶음 안 2(메뉴 화면, 주문 화면). 아직 아무것도 지나지 않아 모두 회색.
  const rails = await ui.findAll({ type: 'Text', text: /^(│|├─|└─)$/ })
  expect(rails.map(r => r.props.color)).toEqual(['subtle', 'subtle', 'subtle', 'subtle'])
  // 예정 앞 셋(사진 모으기, 메뉴 화면, 주문 화면)과 끝 단계(공개하기)가 모두 보여 개수 줄이 없다.
  expect(await ui.find({ type: 'Box', key: 'step-c' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /개 더$/ })).toBeUndefined()
  expect((await ui.find({ type: 'Box', key: 'head' }))?.props.marginBottom).toBe(1)
  expect(await ui.find({ type: 'Box', key: 'calls' })).toBeUndefined()
  await ui.unmount()
})

test('the empty panel keeps a blank row before the running part', async ($, on) => {
  world(on)
  await $.session.start(START)

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Box', key: 'empty' }))?.props.marginBottom).toBe(1)
  await ui.unmount()
})

test('a command with no step underway hangs from a grey dotted line', async ($, on) => {
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
  expect((await ui.find({ type: 'Text', text: /^┆$/ }))?.props.color).toBe('subtle')
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
  expect(await ui.find({ type: 'Text', text: /◉ 사진 모으기.*방금 시작$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /초째/ })).toBeUndefined()
  await ui.unmount()

  await w.clock.advance(30 * SEC)
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing' }))
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /◉ 사진 모으기.*1분째$/ })).toBeDefined()
  // 묶음도 아래 단계의 시작 시각을 따른다.
  expect(await ui.find({ type: 'Text', text: /◉ 화면.*방금 시작$/ })).toBeDefined()
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
  const lines = (await ui.findAll({ type: 'Text', text: /^┆ / })).map(l => l.text)
  expect(lines).toEqual(['┆ ▶ work_state_write', '┆ ▶ 웹 검색 "빵집"', '┆ ▶ 웹 페이지 example.com', '┆ ▶ 스킬 plugin-authoring'])
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
  expect(await ui.findAll({ type: 'Text', text: /^┆ ▶ 작업/ })).toHaveLength(5)
  expect(await ui.find({ type: 'Text', text: /작업6/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^외 2개$/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

// ── 2026-11-24 손질: "- Read"만 보여서는 무엇을 보는지 알 수 없다 ─────────
// 파일·검색 도구는 "▶ 종류 대상"으로 보인다. 경로는 폴더/파일(마지막 두 마디)을 남긴다.
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
  const lines = (await ui.findAll({ type: 'Text', text: /^┆ / })).map(l => l.text)
  expect(lines).toEqual([
    '┆ ▶ 읽기 api/chat.py',
    '┆ ▶ 수정 ai/agent.py',
    '┆ ▶ 작성 me/notes.md',
    '┆ ▶ 검색 "SESSION_RE"',
    '┆ ▶ 찾기 **/*.py',
  ])
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

// 한 호출에 한 줄(사용자가 고름, 2026-11-24). 줄 순서는 시작한 차례, 다섯 줄을 넘으면 "외 n개".
test('each call has its own line and more than five are counted', async ($, on) => {
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

  const ui = await $.ui.mount(pane('terminal', 40))
  const lines = (await ui.findAll({ type: 'Text', text: /^┆ / })).map(l => l.text)
  expect(lines).toEqual([
    '┆ ▶ 읽기 db/load.py',
    '┆ ▶ 검색 "x"',
    '┆ ▶ 읽기 db/chat.py',
    '┆ ▶ 읽기 db/app.py',
    '┆ ▶ 읽기 db/runs.py',
    '┆ 외 1개',
  ])
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
  const lines = (await ui.findAll({ type: 'Text', text: /^┆ / })).map(l => l.text)
  expect(lines).toEqual(['┆ ▶ 읽기 db/load.py'])
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
  expect(await ui.find({ type: 'Text', text: /^─+ 0\/4$/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(72 * MIN)
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: / 0\/4 · 1시간 12분째$/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /^━+ 4\/4 · 2시간 5분$/ })).toBeDefined()
  await ui.unmount()

  // 다 끝난 뒤에는 시간이 더 늘지 않는다.
  await w.clock.advance(10 * MIN)
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /^━+ 4\/4 · 2시간 5분$/ })).toBeDefined()
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

test('a long list in a tall pane shows every step instead of a one-step count', async ($, on) => {
  const w = world(on)
  await longUnderway($, w)

  // 머리 3 + 단계 8 + 세로선 7 = 18줄.
  // 40줄이면 늘린 모양으로 모두 그린다. 18줄이면 늘린 모양(명령 줄 자리 2줄 더)은 안 들어가고, 예정 3개 모양에서
  // 숨는 끝남(자료 수집)과 예정(수정 반영)이 하나씩이라 개수 줄 대신 그 단계를 그려 역시 모두 보인다.
  for (const rows of [40, 18]) {
    const ui = await $.ui.mount(pane('terminal', 40, rows))
    expect(
      await texts(ui, /^● 자료 수집/, /^● 목차 구성/, /^◉ 초안 작성/, /^○ 그림 삽입/, /^○ 맞춤법 검사/, /^○ 검토 요청/, /^○ 수정 반영/, /^○ 게시/),
    ).toEqual([true, true, true, true, true, true, true, true])
    expect(await ui.find({ type: 'Text', text: /개 더$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: / 2\/8 · 2분째$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a long list keeps the last finished step, the next steps and the final step', async ($, on) => {
  const w = world(on)
  await longUnderway($, w)

  // 예정 3개 18줄, 2개 16줄. 16줄이면 2개: 숨는 예정 둘(검토 요청, 수정 반영)은 끝 단계 앞에 개수로.
  const ui = await $.ui.mount(pane('terminal', 40, 16))
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const want = [/^● 자료 수집/, /^● 목차 구성/, /^◉ 초안 작성/, /^○ 그림 삽입/, /^○ 맞춤법 검사/, /^┆ 예정 2개 더$/, /^○ 게시/]
  const at = want.map(re => all.findIndex(t => re.test(t)))
  expect(at.every(i => i >= 0)).toBe(true)
  expect([...at].sort((x, y) => x - y)).toEqual(at)
  expect(await texts(ui, /검토 요청/, /수정 반영/)).toEqual([false, false])
  expect((await ui.find({ type: 'Text', text: /^예정 2개 더$/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('the finished step kept is the one that ended last, not the last in order', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(LONG))
  // 끝난 차례: 목차 구성 → 초안 작성 → 자료 수집. 숨는 끝남이 둘이라 "완료 2개 더"와 자료 수집만 보인다.
  await $.tool.call(tool({ action: 'update', id: 's2', status: 'doing' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 's2', status: 'done' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 's3', status: 'done' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 's1', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 's4', status: 'doing' }))

  // 이 모양을 보려고 높이를 16줄로 둔다. 40줄이면 늘린 모양을 그린다.
  const ui = await $.ui.mount(pane('terminal', 40, 16))
  expect(await texts(ui, /● 자료 수집/, /목차 구성/, /초안 작성/, /^┆ 완료 2개 더$/)).toEqual([true, false, false, true])
  await ui.unmount()
})

test('a shorter pane shows fewer upcoming steps so nothing scrolls', async ($, on) => {
  const w = world(on)
  await longUnderway($, w)

  // 예정 3개 18줄, 2개 16줄, 1개 14줄, 끝난 것까지 빼면 12줄. 13줄이면 12줄 모양. 끝 단계(게시)는 남는다.
  const ui = await $.ui.mount(pane('terminal', 40, 13))
  expect(await texts(ui, /^┆ 완료 2개 더$/, /◉ 초안 작성/, /○ 그림 삽입/, /^┆ 예정 3개 더$/, /^○ 게시/)).toEqual([
    true,
    true,
    true,
    true,
    true,
  ])
  expect(await texts(ui, /목차 구성/, /맞춤법 검사/, /검토 요청/)).toEqual([false, false, false])
  expect((await ui.find({ type: 'Text', text: /^완료 2개 더$/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('a very short pane drops the finished step, then the blank rows, never a step underway', async ($, on) => {
  const w = world(on)
  await longUnderway($, w)
  await $.tool.call(tool({ action: 'update', id: 's4', status: 'doing' }))

  // 진행 중 둘. 예정 1개·완료 빼기 14줄, 예정 0개 12줄, 끝 단계 빼면 10줄, 세로선 줄까지 빼면 7줄.
  let ui = await $.ui.mount(pane('terminal', 40, 9))
  expect(await texts(ui, /^┆ 완료 2개 더$/, /◉ 초안 작성/, /◉ 그림 삽입/, /^┆ 예정 4개 더$/)).toEqual([true, true, true, true])
  expect(await texts(ui, /목차 구성/, /맞춤법 검사/)).toEqual([false, false])
  expect(await ui.findAll({ type: 'Text', text: /^│$/ })).toHaveLength(0)
  await ui.unmount()

  // 무엇으로도 모자라면 가장 짧은 모양으로 그리되 진행 중 단계는 남는다.
  ui = await $.ui.mount(pane('terminal', 40, 5))
  expect(await texts(ui, /◉ 초안 작성/, /◉ 그림 삽입/)).toEqual([true, true])
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
        { id: 'e', label: '뒷정리' },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))

  // 이 모양을 보려고 높이를 14줄로 둔다. 40줄이면 늘린 모양을 그린다.
  const ui = await $.ui.mount(pane('terminal', 40, 14))
  expect(await texts(ui, /^┆ 예정 2개 더$/, /^발표$/, /슬라이드/, /^○ 뒷정리$/)).toEqual([true, false, false, true])
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

  // 이 모양을 보려고 높이를 9줄로 둔다. 40줄이면 늘린 모양을 그린다.
  const ui = await $.ui.mount(pane('terminal', 40, 9))
  expect(await texts(ui, /^┆ 완료 2개 더$/, /● 화면/, /├─● 주문 화면/, /○ 공개하기/)).toEqual([true, true, true, true])
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
  expect(await ui.find({ type: 'Text', text: /◉ 사진 모으기.*5분째$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / 0\/4 · 5분째$/ })).toBeDefined()
  await ui.unmount()

  await turnStart($)
  await w.clock.advance(5 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /● 사진 모으기.*10분$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / 1\/4 · 10분째$/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /◉ 사진 모으기.*5분째$/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /◉ 첫 단계.*5분째$/ })).toBeDefined()
  await ui.unmount()

  await turnStart($)
  await w.clock.advance(2 * MIN)
  ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /◉ 첫 단계.*7분째$/ })).toBeDefined()
  await ui.unmount()
})

// ── 2026-11-26 백그라운드 작업: 턴이 끝나도 백그라운드로 띄운 에이전트·명령이 돌고 있으면 일하는 중이라 센다 ──

const AGENT = { tool: 'Agent' } as const
const launchAgent = ($: Kit) =>
  $.tool.call({ tool: 'Agent', description: '정의 작성', prompt: '정의를 적어 줘', run_in_background: true } as unknown as CallInput)
const launchCommand = ($: Kit) =>
  $.tool.call({ tool: 'Bash', command: 'npm test', description: '전체 테스트', run_in_background: true })
// 백그라운드 작업이 끝나면 그 id를 담은 알림이 입력으로 들어오고 새 턴이 열린다.
const notify = ($: Kit, id: string) =>
  $.prompt.submit({
    text: `<task-notification><task-id>${id}</task-id><status>completed</status></task-notification>`,
    wait: false,
    origin: { kind: 'task-notification' },
  })

for (const kind of ['agent', 'command'] as const) {
  test(`time while a background ${kind} runs after the turn ends is counted, until its notice`, async ($, on) => {
    const w = world(on)
    // 백그라운드 에이전트는 agentId 를, 명령은 backgroundTaskId 를 돌려준다(Claude Code 2.1.332).
    on('tool.call', AGENT, () => ({ result: { status: 'async_launched', agentId: 'job1', description: '정의 작성' } }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: { backgroundTaskId: 'job1' } }))
    on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
    await $.session.start(START)
    await turnStart($)
    await $.tool.call(tool(PLAN))
    await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
    await w.clock.advance(2 * MIN)
    await (kind === 'agent' ? launchAgent($) : launchCommand($))
    await turnEnd($)
    await w.clock.advance(60 * MIN)

    let ui = await $.ui.mount(pane('terminal'))
    expect(await ui.find({ type: 'Text', text: /◉ 사진 모으기.*1시간 2분째$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 0\/4 · 1시간 2분째$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶ / })).toBeUndefined()
    await ui.unmount()

    // 끝 알림으로 열린 턴이 끝나면 돌고 있는 것이 없어 다시 쉰다.
    await notify($, 'job1')
    await turnStart($)
    await w.clock.advance(1 * MIN)
    await turnEnd($)
    await w.clock.advance(30 * MIN)
    ui = await $.ui.mount(pane('terminal'))
    expect(await ui.find({ type: 'Text', text: /◉ 사진 모으기.*1시간 3분째$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /▶ / })).toBeUndefined()
    await ui.unmount()
  })
}

test('time on a question is counted while a background agent runs', async ($, on) => {
  const w = world(on)
  on('tool.call', AGENT, () => ({ result: { status: 'async_launched', agentId: 'job1' } }))
  on('tool.call', { tool: 'AskUserQuestion' } as const, async () => {
    await w.clock.sleep(10 * MIN)
    return { result: {} }
  })
  await $.session.start(START)
  await turnStart($)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(1 * MIN)
  await launchAgent($)
  const call = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as unknown as CallInput)
  await w.clock.settle()
  await w.clock.advance(10 * MIN)
  await call
  // 그리지 않는 백그라운드 작업만 남으면 30초마다 다시 그린다. 다음 그리기까지.
  await w.clock.advance(30 * SEC)

  // 질문 창 동안 쉬었다면 1분째에 머문다.
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /◉ 사진 모으기.*11분째$/ })).toBeDefined()
  await ui.unmount()
})

// TaskStop 으로 멈춘 작업은 끝 알림이 오지 않는다(2026-11-26 화면에서 확인). 남아 있으면 시간이 멈추지 않는다.
test('a background task stopped with TaskStop no longer keeps the time running', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { backgroundTaskId: 'job1' } }))
  on('tool.call', { tool: 'TaskStop' } as const, () => ({ result: {} }))
  await $.session.start(START)
  await turnStart($)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(2 * MIN)
  await launchCommand($)
  await w.clock.advance(1 * MIN)
  await $.tool.call({ tool: 'TaskStop', task_id: 'job1' } as unknown as CallInput)
  await turnEnd($)
  await w.clock.advance(30 * MIN)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /◉ 사진 모으기 +3분째$/ })).toBeDefined()
  await ui.unmount()
})

test('a list from a window closed while a background task ran stops when the window was last seen', async ($, on) => {
  // 꺼진 창은 백그라운드 작업을 돌리며 쉬지 않은 채로, 55분 전에 마지막으로 살아 있었다.
  const old: Board = {
    title: '지난 작업',
    updatedAt: T0 - 58 * MIN,
    steps: [
      { id: 'x', label: '첫 단계', status: 'doing', startedAt: T0 - 60 * MIN },
      { id: 'y', label: '둘째 단계', status: 'todo' },
    ],
  }
  world(on, { sessionId: 'S2', store: { [`board:${ROOT_KEY}:OLD`]: entry('OLD', T0 - 55 * MIN, old) } })
  await $.session.start(START)

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /◉ 첫 단계.*5분째$/ })).toBeDefined()
  await ui.unmount()
})

test('after /resume away while a background agent runs, the list left behind stops then', async ($, on) => {
  const ids: { sessionId: string } = { sessionId: 'S1' }
  const w = world(on, ids)
  on('tool.call', AGENT, () => ({ result: { status: 'async_launched', agentId: 'job1' } }))
  await $.session.start(START)
  await turnStart($)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(2 * MIN)
  await launchAgent($)
  await turnEnd($)
  await w.clock.advance(3 * MIN)
  await $.session.end({ reason: 'resume', sessionId: 'S1', resume: { id: 'S2' } })
  ids.sessionId = 'S2'
  await w.clock.advance(60 * MIN)
  await $.session.end({ reason: 'resume', sessionId: 'S2', resume: { id: 'S1' } })
  ids.sessionId = 'S1'

  // S1 로 돌아오면 떠날 때(5분)에서 멈춰 있다.
  await $.tool.call(tool({ action: 'show' }))
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /◉ 사진 모으기.*5분째$/ })).toBeDefined()
  await ui.unmount()
})

// ── 2026-11-24 진행선 모양: 한 줄 막대, 왼쪽 세로선, 단계 아래 붙는 줄 ─────────

test('the head is one thin bar with the count and the time, as wide as the pane', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing' }))
  await w.clock.advance(17 * MIN)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface, 40))
    // 시간 숫자는 단계 줄과 같은 셈을 따른다(여기서는 16분째). 이 테스트는 모양만 본다.
    const bar = await ui.find({ type: 'Text', text: /^━+─+ 1\/4 · \d+분째$/ })
    expect(cells(bar?.text ?? '')).toBe(40)
    expect((await ui.find({ type: 'Text', text: /^1\/4$/ }))?.props.bold).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^ · \d+분째$/ }))?.props.dimColor).toBe(true)
    expect(await ui.find({ type: 'Progress' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /완료 · / })).toBeUndefined()
    await ui.unmount()
  }
})

test('each status has its own mark and color, on terminal and desktop', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing' }))
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'blocked' }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe('success')
    // 첫 ◉ 는 묶음(화면)의 표시: 아래 단계가 진행 중이라 묶음도 진행 중.
    expect((await ui.find({ type: 'Text', text: /^◉$/ }))?.props.color).toBe('claude')
    expect((await ui.find({ type: 'Text', text: /^○$/ }))?.props.color).toBe('subtle')
    expect((await ui.find({ type: 'Text', text: /^▲$/ }))?.props.color).toBe('warning')
    // 묶음 이름은 기본 색 굵게. 주황은 진행 중인 단계 이름에만.
    const group = await ui.find({ type: 'Text', text: /^화면$/ })
    expect(group?.props.bold).toBe(true)
    expect(group?.props.color).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^메뉴 화면$/ }))?.props.color).toBe('claude')
    await ui.unmount()
  }

  await $.tool.call(tool({ action: 'update', id: 'a', status: 'skipped' }))
  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Text', text: /^–$/ }))?.props.color).toBe('subtle')
  await ui.unmount()
})

test('the rail is green where the work has passed, in the step color where it is now, and grey ahead', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing' }))
  const colors = async (rows = 40) => {
    const ui = await $.ui.mount(pane('terminal', 40, rows))
    const got = (await ui.findAll({ type: 'Text', text: /^(│|├─|└─)$/ })).map(r => r.props.color)
    await ui.unmount()
    return got
  }

  // 사진 모으기→화면(지나옴), 메뉴 화면·주문 화면(지금 묶음 안), 화면→공개하기(앞으로)
  expect(await colors()).toEqual(['success', 'claude', 'claude', 'subtle'])

  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'blocked' }))
  expect(await colors()).toEqual(['success', 'warning', 'warning', 'subtle'])

  for (const id of ['b1', 'b2', 'c']) await $.tool.call(tool({ action: 'update', id, status: 'done' }))
  // 다 끝나면 모두 초록. 40줄이면 끝난 단계가 모두 보인다.
  expect(await colors()).toEqual(['success', 'success', 'success', 'success'])
  // 6줄이면 숨긴 것(완료 3개 더)과 마지막 단계 사이도 초록.
  expect(await colors(6)).toEqual(['success'])
  const ui = await $.ui.mount(pane('terminal', 40, 6))
  expect((await ui.find({ type: 'Text', text: /^┆$/ }))?.props.color).toBe('success')
  await ui.unmount()
})

test('with no command running there is no running part at all', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Box', key: 'calls' })).toBeUndefined()
  // 예전 구분선(패널 폭만큼의 ─)이 없다. 머리 막대의 빈 부분(─)은 그보다 짧다.
  expect(await ui.find({ type: 'Text', text: /^─{40}$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /실행 중인 작업 없음/ })).toBeUndefined()
  await ui.unmount()
})

test('with no list a running command sits under the empty note, one blank row apart', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await $.session.start(START)
  const call = $.tool.call({ tool: 'Bash', command: 'pytest test/db' })
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Box', key: 'empty' }))?.props.marginBottom).toBe(1)
  expect((await ui.find({ type: 'Box', key: 'calls' }))?.props.marginTop).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^┆ ▶ pytest test\/db$/ })).toBeDefined()
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await call
})

// ── 2026-11-24 진행선 모양: 돌고 있는 명령은 진행 중 단계 아래에 ─────────

// 패널에 그려진 줄(표시·세로선·점선으로 시작하는 Text)을 위에서부터.
async function railRows(ui: { findAll: (q: { type: 'Text'; text: RegExp }) => Promise<{ text: string }[]> }) {
  return (await ui.findAll({ type: 'Text', text: /^(?:[◉○●▲–┆│] |[├└]─[◉○●▲–] |  ┆ )/ })).map(t => t.text)
}

// 설명이 있는 5초짜리 셸 명령들을 띄우고 1초 넘게 기다린다(실행 중 줄은 1초 뒤에 보인다).
async function runBash($: Kit, w: ReturnType<typeof world>, ...descriptions: string[]) {
  const calls = descriptions.map((d, i) =>
    $.tool.call({ tool: 'Bash', command: `job ${i}`, description: d } as unknown as CallInput),
  )
  await w.clock.settle()
  await w.clock.advance(2500)
  return calls
}

test('running commands hang under the step underway', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  const calls = await runBash($, w, '테스트 실행')

  const ui = await $.ui.mount(pane('terminal'))
  const rows = await railRows(ui)
  expect(rows[rows.findIndex(r => /^◉ 사진 모으기/.test(r)) + 1]).toBe('┆ ▶ 테스트 실행')
  // 맨 위 단계 아래 점선은 그 단계의 색.
  expect((await ui.find({ type: 'Text', text: /^┆$/ }))?.props.color).toBe('claude')
  expect(await ui.find({ type: 'Box', key: 'calls' })).toBeUndefined()
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('inside a group the command line keeps the rail', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing' }))
  const calls = await runBash($, w, '테스트 실행')

  const ui = await $.ui.mount(pane('terminal'))
  const rows = await railRows(ui)
  expect(rows[rows.findIndex(r => /^├─◉ 메뉴 화면/.test(r)) + 1]).toBe('│ ┆ ▶ 테스트 실행')
  expect(await ui.find({ type: 'Box', key: 'calls' })).toBeUndefined()
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('with two steps underway the command goes under the one started last', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing' }))
  const calls = await runBash($, w, '테스트 실행')

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /^│ ┆ ▶ 테스트 실행$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^┆ ▶ 테스트 실행$/ })).toBeUndefined()
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('with only a blocked step the command goes to the bottom', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'blocked' }))
  const calls = await runBash($, w, '테스트 실행')

  const ui = await $.ui.mount(pane('terminal'))
  expect((await ui.find({ type: 'Box', key: 'calls' }))?.props.marginTop).toBe(1)
  expect(await ui.find({ type: 'Text', text: /^┆ ▶ 테스트 실행$/ })).toBeDefined()
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('a note comes before the commands under the same step', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing', note: '자료 12장' }))
  const calls = await runBash($, w, '테스트 실행')

  const ui = await $.ui.mount(pane('terminal'))
  const rows = await railRows(ui)
  expect(rows[rows.indexOf('┆ 자료 12장') + 1]).toBe('┆ ▶ 테스트 실행')
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('hanging commands are counted so the pane does not scroll', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await longUnderway($, w)
  const calls = await runBash($, w, '작업1', '작업2', '작업3')

  // 예정 3개 18줄, 2개 16줄, 1개 14줄, 끝난 것 빼면 12줄. 명령 3줄을 더하면 15줄에는 12줄 모양만 들어간다.
  // 단계 아래 붙은 명령은 빈 줄을 따로 두지 않는다. 끝 단계(게시)는 남는다.
  const ui = await $.ui.mount(pane('terminal', 40, 15))
  expect(await texts(ui, /○ 그림 삽입/, /맞춤법 검사/, /^┆ ▶ 작업3$/, /목차 구성/, /^○ 게시/)).toEqual([true, false, true, false, true])
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('a hanging command line fits a narrow pane', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Read')
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing' }))
  const calls = ['load.py', 'chat.py', 'app.py', 'runs.py', 'store.py'].map(f =>
    $.tool.call({ tool: 'Read', file_path: `C:/a/very-long-folder-name/${f}`, offset: 120, limit: 80 } as unknown as CallInput),
  )
  await w.clock.settle()
  await w.clock.advance(2500)

  // 폴더와 줄 범위를 빼면 들어간다: "│ ┆ ▶ 읽기 load.py".
  const ui = await $.ui.mount(pane('terminal', 24))
  const lines = (await ui.findAll({ type: 'Text', text: /^│ ┆ / })).map(l => l.text)
  expect(lines).toEqual(['load.py', 'chat.py', 'app.py', 'runs.py', 'store.py'].map(f => `│ ┆ ▶ 읽기 ${f}`))
  for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(24)
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('more than five commands under a step count the rest', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  const calls = await runBash($, w, '작업1', '작업2', '작업3', '작업4', '작업5', '작업6', '작업7')

  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.findAll({ type: 'Text', text: /^┆ ▶ 작업/ })).toHaveLength(5)
  expect(await ui.find({ type: 'Text', text: /^┆ 외 2개$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^외 2개$/ }))?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Box', key: 'calls' })).toBeUndefined()
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

// ── 2026-11-24 손질: 원문자 겹침, 이모지 폭, 좁은 패널의 머리 막대 ─────────
// 원문자(①…)는 터미널이 1칸을 주는데 글꼴이 2칸으로 그려 다음 글자를 덮는다(사용자 화면). 보통 숫자로 바꿔 그린다.

test('circled numbers are drawn as plain digits so they do not overlap', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '그림 ③ 정리',
      steps: [
        { id: 'x', label: '넘겨주기(그림 ③)' },
        { id: 'y', label: '도구와 인자(그림 ④⑤)' },
        { id: 'z', label: 'Ⅳ장' },
        { id: 'k', label: 'ㅋㅋ 메모' },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 'x', status: 'doing', note: '❶ 확인' }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(
      await texts(ui, /^◉ 넘겨주기\(그림 3\)/, /^○ 도구와 인자\(그림 4,5\)$/, /^○ IV장$/, /^○ ㅋㅋ 메모$/, /^┆ 1\. 확인$/, /^그림 3 정리$/),
    ).toEqual([true, true, true, true, true, true])
    expect(await ui.find({ type: 'Text', text: /[③④⑤❶Ⅳ]/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the box above the prompt also draws circled numbers as digits', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool({ action: 'plan', title: '그림 정리', steps: [{ id: 'x', label: '넘겨주기(그림 ③)' }] }))
  await $.tool.call(tool({ action: 'update', id: 'x', status: 'blocked', note: '그림 ⑤ 없음' }))

  const b = await $.ui.mount(band('terminal'))
  expect(await b.find({ type: 'Text', text: /^⚠ 넘겨주기\(그림 3\)에서 막힘: 그림 5 없음$/ })).toBeDefined()
  await b.unmount()
})

// 숫자 바로 뒤의 원문자는 쉼표로 나눠 다른 수로 읽히지 않게 한다(Task 1① → Task 1,1, 2026-11-25). 영문자 뒤는 붙인다.
test('a circled number right after a digit is set off with a comma', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '원문자',
      steps: [
        { id: 'a', label: 'Task 1①' },
        { id: 'b', label: '그림 2③ 보기' },
        { id: 'c', label: 'Step①' },
        { id: 'd', label: '1①② 비교' },
      ],
    }),
  )

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await texts(ui, /^○ Task 1,1$/, /^○ 그림 2,3 보기$/, /^○ Step1$/, /^○ 1,1,2 비교$/)).toEqual([true, true, true, true])
    await ui.unmount()
  }
})

// 반대 방향도: 원문자 바로 뒤의 보통 숫자는 쉼표로 나눈다(그림 ③4 → 그림 3,4). 영문자는 붙인다.
test('a plain digit right after a circled number is set off with a comma', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '원문자 뒤 숫자',
      steps: [
        { id: 'a', label: '그림 ③4 보기' },
        { id: 'b', label: '①②3 비교' },
        { id: 'c', label: '③a 확인' },
        { id: 'd', label: '장 ④ 5절' },
      ],
    }),
  )

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await texts(ui, /^○ 그림 3,4 보기$/, /^○ 1,2,3 비교$/, /^○ 3a 확인$/, /^○ 장 4 5절$/)).toEqual([true, true, true, true])
    await ui.unmount()
  }
})

// 맨 앞에서 빈칸이 뒤따르는 번호 하나는 목록 번호로 읽히게 점을 붙인다(❶ 자료 → 1. 자료). 중간 번호, 붙은 번호, 빈칸 없는 번호는 숫자만 남긴다.
test('a lone number at the start followed by a space becomes a list mark like 1.', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '① 자료 정리',
      steps: [
        { id: 'a', label: '❶ 자료 12장 모음' },
        { id: 'b', label: '⑫ 마무리' },
        { id: 'c', label: '④⑤ 비교' },
        { id: 'd', label: '③번 확인' },
        { id: 'g', label: '그림 ③ 보기' },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing', note: '② 다시 확인' }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(
      await texts(
        ui,
        /^1\. 자료 정리$/,
        /^◉ 1\. 자료 12장 모음/,
        /^┆ 2\. 다시 확인$/,
        /^○ 12\. 마무리$/,
        /^○ 4,5 비교$/,
        /^○ 3번 확인$/,
        /^○ 그림 3 보기$/,
      ),
    ).toEqual([true, true, true, true, true, true, true])
    await ui.unmount()
  }

  // 대기 단계는 3개까지만 보이므로 나머지는 새 목록으로 본다.
  await $.tool.call(tool({ action: 'plan', title: '준비', steps: [{ id: 'e', label: '⑴ 준비' }, { id: 'f', label: 'Ⓐ 안' }] }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await texts(ui, /^○ \(1\) 준비$/, /^○ A\. 안$/)).toEqual([true, true])
    await ui.unmount()
  }
})

test('the box above the prompt also shows a leading number as a list mark', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool({ action: 'plan', title: '자료', steps: [{ id: 'a', label: '❶ 자료 모음' }] }))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'blocked', note: '⑤ 없음' }))

  const b = await $.ui.mount(band('terminal'))
  expect(await b.find({ type: 'Text', text: /^⚠ 1\. 자료 모음에서 막힘: 5\. 없음$/ })).toBeDefined()
  await b.unmount()
})

test('an emoji counts as two cells so the time stays at the right edge', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool({ action: 'plan', title: '배포', steps: [{ id: 'x', label: '배포 🚀' }, { id: 'y', label: '확인' }] }))
  await $.tool.call(tool({ action: 'update', id: 'x', status: 'doing' }))
  await w.clock.advance(5 * MIN)

  const ui = await $.ui.mount(pane('terminal', 40))
  const row = await ui.find({ type: 'Text', text: /^◉ 배포 🚀 +\d+분째$/ })
  expect(cells(row?.text ?? '')).toBe(40)
  await ui.unmount()
})

// ⚠·✔처럼 보통 1칸인 글자도 뒤에 U+FE0F가 붙으면 이모지로 그려 2칸이다(2026-11-25 검토).
test('a sign followed by the emoji selector counts as two cells', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool({ action: 'plan', title: '설정', steps: [{ id: 'x', label: '\u26a0\ufe0f 설정 확인' }, { id: 'y', label: '마무리' }] }))
  await $.tool.call(tool({ action: 'update', id: 'x', status: 'doing' }))
  await w.clock.advance(5 * MIN)

  const ui = await $.ui.mount(pane('terminal', 40))
  // 40칸 = 표시와 빈칸 2 + 이름 12(⚠️ 2, 빈칸 2, 한글 8) + 빈칸 21 + 시간 5
  expect(await ui.find({ type: 'Text', text: /^◉ \u26a0\ufe0f 설정 확인 {21}5분째$/ })).toBeDefined()
  expect(cells('\u26a0\ufe0f 설정 확인')).toBe(12)
  expect(cells('1\ufe0f\u20e3 준비')).toBe(7)
  await ui.unmount()
})

test('in a very narrow pane the head line drops the time before it overflows', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(72 * MIN)

  const ui = await $.ui.mount(pane('terminal', 16))
  const bar = await ui.find({ type: 'Text', text: /^─+ 0\/4$/ })
  expect(cells(bar?.text ?? '')).toBe(16)
  await ui.unmount()
})

// 단계가 막대 칸보다 훨씬 많아도 막대는 다 끝났을 때만 꽉 차고, 하나라도 끝났으면 한 칸은 채운다.
test('the bar is full only when all is done and shows any finished step', async ($, on) => {
  world(on)
  await $.session.start(START)
  const hundred = (done: number) =>
    tool({
      action: 'plan',
      title: '백 단계',
      steps: Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, label: `단계 ${i}`, ...(i < done ? { status: 'done' } : {}) })),
    })

  await $.tool.call(hundred(1))
  let ui = await $.ui.mount(pane('terminal', 40))
  expect(await ui.find({ type: 'Text', text: /^━+─+ 1\/100$/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call(hundred(99))
  ui = await $.ui.mount(pane('terminal', 40))
  expect(await ui.find({ type: 'Text', text: /^━+─+ 99\/100$/ })).toBeDefined()
  await ui.unmount()
})

// ── 2026-11-24 손질: 끝 단계 ─────────────────────────────────────────────

test('the final step stays in view even when it sits in a group', async ($, on) => {
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
        { id: 'e', label: '연습' },
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

  // 예정 3개 16줄, 2개 14줄, 1개 12줄, 0개 10줄. 10줄이면 0개: 준비, 예정 4개 더, 발표, 슬라이드, 리허설.
  // 묶음 안에서 혼자 숨는 슬라이드는 개수 대신 이름으로 그린다(줄 수가 같다).
  const ui = await $.ui.mount(pane('terminal', 40, 10))
  await expectRows(ui, [/^◉ 준비/, /^┆ 예정 4개 더$/, /^○ 발표$/, /^├─○ 슬라이드$/, /^└─○ 리허설$/])
  expect(await texts(ui, /자료 조사/)).toEqual([false])
  await ui.unmount()
})

test('a single hidden step with a note stays a count so the pane does not grow', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '여행',
      steps: [
        { id: 'a', label: '일정' },
        { id: 'b', label: '숙소' },
        { id: 'c', label: '교통' },
        { id: 'd', label: '짐' },
        { id: 'e', label: '환전' },
        { id: 'f', label: '출발' },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))

  // 숨는 예정은 환전 하나. 메모가 없으면 그 단계를 그린다.
  // 이 모양을 보려고 높이를 14줄로 둔다. 40줄이면 늘린 모양을 그린다.
  let ui = await $.ui.mount(pane('terminal', 40, 14))
  expect(await texts(ui, /^○ 환전$/, /개 더$/)).toEqual([true, false])
  await ui.unmount()

  // 메모가 있으면 그리면 한 줄 늘어나므로 개수로 둔다.
  await $.tool.call(tool({ action: 'update', id: 'e', status: 'todo', note: '은행 예약' }))
  // 이 모양을 보려고 높이를 14줄로 둔다. 40줄이면 늘린 모양을 그린다.
  ui = await $.ui.mount(pane('terminal', 40, 14))
  expect(await texts(ui, /^┆ 예정 1개 더$/, /환전/, /^○ 출발$/)).toEqual([true, false, true])
  await ui.unmount()
})

// ── 2026-11-24 손질: 묶음 가지, 한 호출 한 줄 ─────────────────────────────

test('steps in a group branch off the rail, and the very last one closes it', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing' }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // 묶음(화면) 뒤에 공개하기가 있으므로 두 가지 모두 ├─.
    expect(await texts(ui, /^├─◉ 메뉴 화면/, /^├─○ 주문 화면$/, /^└─/)).toEqual([true, true, false])
    await ui.unmount()
  }

  await $.tool.call(
    tool({
      action: 'plan',
      title: '정리',
      steps: [
        { id: 'a', label: '준비' },
        { id: 'g', label: '마무리', children: [{ id: 'g1', label: '청소' }, { id: 'g2', label: '보고' }] },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 'g2', status: 'doing', note: '확인' }))
  const ui = await $.ui.mount(pane('terminal'))
  const rows = await railRows(ui)
  const at = rows.findIndex(r => /^└─◉ 보고/.test(r))
  expect(at).toBeGreaterThan(-1)
  expect(rows[at + 1]).toBe('  ┆ 확인')
  expect(await texts(ui, /^├─○ 청소$/)).toEqual([true])
  await ui.unmount()
})

test('a read shows its folder, file and line range, a search its pattern and scope', async ($, on) => {
  const w = world(on)
  for (const name of ['Read', 'Grep', 'Glob']) slow(on, w, name)
  await $.session.start(START)
  const calls = [
    $.tool.call({ tool: 'Read', file_path: 'C:/Users/me/Proj/db/load.py', offset: 120, limit: 80 } as unknown as CallInput),
    $.tool.call({ tool: 'Grep', pattern: 'SESSION_RE', path: 'C:/Users/me/Proj/db' } as unknown as CallInput),
    $.tool.call({ tool: 'Grep', pattern: 'x', glob: '*.py' } as unknown as CallInput),
    $.tool.call({ tool: 'Glob', pattern: '**/*.tsx', path: 'C:/Users/me/Proj/web' } as unknown as CallInput),
  ]
  await w.clock.settle()
  await w.clock.advance(2500)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const lines = (await ui.findAll({ type: 'Text', text: /^┆ / })).map(l => l.text)
    expect(lines).toEqual([
      '┆ ▶ 읽기 db/load.py:120-199',
      '┆ ▶ 검색 "SESSION_RE" · db',
      '┆ ▶ 검색 "x" · *.py',
      '┆ ▶ 찾기 **/*.tsx · web',
    ])
    // 종류는 흐리게, ▶는 앞 점선과 같은 색.
    expect((await ui.find({ type: 'Text', text: /^읽기$/ }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^▶$/ }))?.props.color).toBe('subtle')
    await ui.unmount()
  }
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

// 경로가 . ~ .. 드라이브뿐이면 범위로 뜻이 없으므로 없는 것으로 본다. 검색은 glob, 그다음 type을 범위로 보인다(2026-11-25).
test('a search over "." or a drive shows the glob instead, or nothing', async ($, on) => {
  const w = world(on)
  for (const name of ['Read', 'Grep', 'Glob']) slow(on, w, name)
  await $.session.start(START)
  const calls = [
    $.tool.call({ tool: 'Grep', pattern: 'foo', path: '.', glob: '*.ts' } as unknown as CallInput),
    $.tool.call({ tool: 'Glob', pattern: '**/*.tsx', path: 'C:\\' } as unknown as CallInput),
    $.tool.call({ tool: 'Glob', pattern: '*.md', path: './web/.' } as unknown as CallInput),
    $.tool.call({ tool: 'Grep', pattern: 'bar', path: '~', type: 'py' } as unknown as CallInput),
    $.tool.call({ tool: 'Read', file_path: './notes.md' } as unknown as CallInput),
  ]
  await w.clock.settle()
  await w.clock.advance(2500)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const lines = (await ui.findAll({ type: 'Text', text: /^┆ / })).map(l => l.text)
    expect(lines).toEqual([
      '┆ ▶ 검색 "foo" · *.ts',
      '┆ ▶ 찾기 **/*.tsx',
      '┆ ▶ 찾기 *.md · web',
      '┆ ▶ 검색 "bar" · py',
      '┆ ▶ 읽기 notes.md',
    ])
    await ui.unmount()
  }
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('a search whose path ends in .. shows the glob', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Grep')
  await $.session.start(START)
  const call = $.tool.call({ tool: 'Grep', pattern: 'baz', path: 'C:/Users/me/..', glob: '*.md' } as unknown as CallInput)
  await w.clock.settle()
  await w.clock.advance(2500)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    const lines = (await ui.findAll({ type: 'Text', text: /^┆ / })).map(l => l.text)
    expect(lines).toEqual(['┆ ▶ 검색 "baz" · *.md'])
    await ui.unmount()
  }
  await w.clock.advance(5 * SEC)
  await call
})

test('the arrow of a command under a step takes the step color', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  const calls = await runBash($, w, '테스트 실행')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ type: 'Text', text: /^┆ ▶ 테스트 실행$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^▶$/ }))?.props.color).toBe('claude')
    await ui.unmount()
  }
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

// ── 2026-11-24 손질: 명령이 붙는 자리 ────────────────────────────────────
// 막혔다가 다시 진행 중이 된 단계는 그때 시작한 것으로 본다(사용자가 정함).

test('a step started again after being blocked takes the commands', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'blocked' }))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  const calls = await runBash($, w, '사진 압축')

  const ui = await $.ui.mount(pane('terminal'))
  const rows = await railRows(ui)
  expect(rows[rows.findIndex(r => /^◉ 사진 모으기/.test(r)) + 1]).toBe('┆ ▶ 사진 압축')
  expect(await ui.find({ type: 'Text', text: /^│ ┆ ▶/ })).toBeUndefined()
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('a step underway again in a new plan keeps the time it started again', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  // 공개하기가 먼저 시작했다가 막히고, 메뉴 화면이 시작한 뒤, 같은 제목으로 다시 적으며 공개하기를 진행 중으로.
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'doing' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'c', status: 'blocked' }))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ ...PLAN, steps: PLAN.steps.map(s => (s.id === 'c' ? { ...s, status: 'doing' } : s)) }))
  const calls = await runBash($, w, '배포 준비')

  const ui = await $.ui.mount(pane('terminal'))
  const rows = await railRows(ui)
  expect(rows[rows.findIndex(r => /^◉ 공개하기/.test(r)) + 1]).toBe('┆ ▶ 배포 준비')
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('the step started last takes the commands even when it comes first in the list', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  const calls = await runBash($, w, '테스트 실행')

  const ui = await $.ui.mount(pane('terminal'))
  const rows = await railRows(ui)
  expect(rows[rows.findIndex(r => /^◉ 사진 모으기/.test(r)) + 1]).toBe('┆ ▶ 테스트 실행')
  expect(await ui.find({ type: 'Text', text: /^│ ┆ ▶/ })).toBeUndefined()
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('a background command is not drawn while others hang under the step', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async ($$, e) => {
    if ((e as unknown as { run_in_background?: boolean }).run_in_background) return { result: { backgroundTaskId: 't1' } }
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: '서버 실행', run_in_background: true })
  const call = $.tool.call({ tool: 'Bash', command: 'npm test', description: '테스트 실행' })
  await w.clock.settle()
  await w.clock.advance(2500)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ type: 'Box', key: 'calls' })).toBeUndefined()
    const rows = await railRows(ui)
    const under = rows[rows.findIndex(r => /^◉ 사진 모으기/.test(r)) + 1]
    expect(under).toBe('┆ ▶ 테스트 실행')
    expect(rows.filter(r => /서버 실행/.test(r))).toHaveLength(0)
    await ui.unmount()
  }
  await w.clock.advance(5 * SEC)
  await call
})

test('rail, branch and dot colors are the same on terminal and desktop', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'b1', status: 'doing', note: '시안 둘' }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    // 사진 모으기→화면(지나옴), 메뉴 화면 가지·그 메모의 세로선·주문 화면 가지(지금 묶음), 화면→공개하기(앞으로)
    const got = (await ui.findAll({ type: 'Text', text: /^(│|├─|└─)$/ })).map(r => r.props.color)
    expect(got).toEqual(['success', 'claude', 'claude', 'claude', 'subtle'])
    expect((await ui.find({ type: 'Text', text: /^┆$/ }))?.props.color).toBe('claude')
    await ui.unmount()
  }
})

// ── 2026-11-25 기능 끝 검토(reviews/02_기능끝-검토.md)에서 고친 것 ──────────────
// A. 끝 단계가 묶음 안이고 그 묶음의 다른 단계도 보이면 "예정 n개 더"는 묶음 안 끝 단계 앞에 온다.
//    묶음 위에 두면 진행 중인 묶음보다 예정 줄이 먼저 나오고 세로선 색이 어긋난다.

const CHORES = {
  action: 'plan',
  title: '집안일',
  steps: [
    { id: 'a', label: '준비' },
    {
      id: 'g',
      label: '마무리',
      children: [
        { id: 'g1', label: '청소' },
        { id: 'g2', label: '분리수거' },
        { id: 'g3', label: '설거지' },
        { id: 'g4', label: '빨래' },
        { id: 'g5', label: '보고서' },
        { id: 'g6', label: '보고' },
      ],
    },
  ],
}

// 2026-11-25 이후: 묶음 안에서 혼자 숨는 단계는 개수 대신 이름으로 그린다. 여기선 보고서가 그 단계다.
test('with the last group underway its hidden step stays inside it, before the final step', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(CHORES))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'g1', status: 'doing' }))

  for (const surface of SURFACES) {
    // 혼자 숨는 규칙을 보려고 높이를 12줄로 둔다. 40줄이면 늘린 모양이 모두 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 12))
    const rows = await railRows(ui)
    const want = [/^● 준비/, /^◉ 마무리/, /^├─◉ 청소/, /^├─○ 분리수거$/, /^├─○ 설거지$/, /^├─○ 빨래$/, /^├─○ 보고서$/, /^└─○ 보고$/]
    expect(rows.length).toBe(want.length)
    want.forEach((re, i) => expect(rows[i]).toMatch(re))
    // 지나온 곳(준비→마무리)은 초록, 지금 묶음의 가지와 예정 줄의 세로선은 진행 색.
    const got = (await ui.findAll({ type: 'Text', text: /^(│|├─|└─)$/ })).map(r => r.props.color)
    expect(got).toEqual(['success', 'claude', 'claude', 'claude', 'claude', 'claude', 'claude'])
    await ui.unmount()
  }
})

test('with the last group ahead the count of hidden steps sits before its final step, not above the group', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(CHORES))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))

  for (const surface of SURFACES) {
    // 이 모양을 보려고 높이를 11줄로 둔다. 40줄이면 늘린 모양을 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 11))
    const rows = await railRows(ui)
    const want = [/^◉ 준비/, /^○ 마무리$/, /^├─○ 청소$/, /^├─○ 분리수거$/, /^├─○ 설거지$/, /^│ ┆ 예정 2개 더$/, /^└─○ 보고$/]
    expect(rows.length).toBe(want.length)
    want.forEach((re, i) => expect(rows[i]).toMatch(re))
    await ui.unmount()
  }
})

// B. 같은 설명의 백그라운드 명령이 돌아도 보통 명령은 단계 아래에 한 줄로 보인다(백그라운드는 그리지 않는다).
test('a background command with the same description does not hide the running one', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Bash' }, async ($$, e) => {
    if ((e as unknown as { run_in_background?: boolean }).run_in_background) return { result: { backgroundTaskId: 't1' } }
    await w.clock.sleep(5 * SEC)
    return { result: {} }
  })
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --watch', description: '테스트 실행', run_in_background: true })
  const call = $.tool.call({ tool: 'Bash', command: 'npm test', description: '테스트 실행' })
  await w.clock.settle()
  await w.clock.advance(2500)

  const ui = await $.ui.mount(pane('terminal'))
  const rows = await railRows(ui)
  expect(rows[rows.findIndex(r => /^◉ 사진 모으기/.test(r)) + 1]).toBe('┆ ▶ 테스트 실행')
  expect(rows.filter(r => r === '┆ ▶ 테스트 실행')).toHaveLength(1)
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await call
})

// C. Review Focus 3: 앞 버전이 적어 둔 실행 중 항목(kind '파일 읽기', label '파일 읽기: x.py')이 남아 있어도 한 줄로 그린다.
//    $.state 는 다시 불러와도 남으므로 엔진 자리(state.get)가 옛 값을 돌려주게 한다.
test('a running entry saved by the older panel still draws on one line', async ($, on) => {
  world(on)
  const OLD = [{ id: 'o1', label: '파일 읽기: x.py', kind: '파일 읽기', target: 'x.py', startedAt: T0 - 60_000, isBackground: false }]
  on('state.get', { plugin: 'progress-panel', key: 'running' }, () => ({
    value: { value: { shape: 'running-1', value: OLD }, version: 1 },
  }))
  on('state.set', { plugin: 'progress-panel', key: 'running' }, () => ({ value: { isSet: true, version: 1 } }))
  await $.session.start(START)
  await $.tool.call(tool(PLAN))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))

  for (const cols of [40, 24]) {
    const ui = await $.ui.mount(pane('terminal', cols))
    const rows = await railRows(ui)
    const line = rows[rows.findIndex(r => /^◉ 사진 모으기/.test(r)) + 1]
    expect(line).toBe('┆ ▶ 파일 읽기 x.py')
    expect(cells(line ?? '')).toBeLessThanOrEqual(cols)
    await ui.unmount()
  }
})

// ── 2026-11-25 검토에서 남긴 것: 숨긴 예정은 있던 자리마다 개수로 ─────────────────
// 숨긴 예정 단계가 이어진 덩어리마다 그 자리에 "예정 n개 더"를 적는다(사용자가 고름, A안).
// 맨 위 덩어리가 1개이고 메모가 없으면 개수 대신 그 단계를 그린다.

const SKIP = {
  action: 'plan',
  title: '앱 출시',
  steps: [
    { id: 'p1', label: '기획' },
    { id: 'p2', label: '조사' },
    { id: 'p3', label: '설계' },
    { id: 'p4', label: '시안' },
    { id: 'p5', label: '개발' },
    { id: 'p6', label: '검수' },
    { id: 'p7', label: '배포 준비' },
    { id: 'p8', label: '공개' },
  ],
}

// 진행선 줄이 꼭 이 차례로, 이만큼만 그려졌는지.
async function expectRows(ui: Parameters<typeof railRows>[0], want: RegExp[]) {
  const rows = await railRows(ui)
  expect(rows.length).toBe(want.length)
  want.forEach((re, i) => expect(rows[i]).toMatch(re))
}

test('a later step started first: the hidden steps are counted where they are', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(SKIP))
  await $.tool.call(tool({ action: 'update', id: 'p5', status: 'doing' }))

  // 숨는 예정: 시안(개발 앞), 검수·배포 준비(개발 뒤). 시안은 혼자라 이름으로 그린다.
  for (const surface of SURFACES) {
    // 이 모양을 보려고 높이를 16줄로 둔다. 40줄이면 늘린 모양을 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 16))
    await expectRows(ui, [/^○ 기획$/, /^○ 조사$/, /^○ 설계$/, /^○ 시안$/, /^◉ 개발/, /^┆ 예정 2개 더$/, /^○ 공개$/])
    await ui.unmount()
  }
})

test('two places with hidden steps each get their own count', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(SKIP))
  await $.tool.call(tool({ action: 'update', id: 'p4', status: 'todo', note: '확인 중' }))
  await $.tool.call(tool({ action: 'update', id: 'p5', status: 'doing' }))

  // 시안은 메모가 있어 그리면 줄이 늘므로 개수로 둔다. 개수 줄 둘이 모두 그려진다.
  for (const surface of SURFACES) {
    // 이 모양을 보려고 높이를 16줄로 둔다. 40줄이면 늘린 모양을 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 16))
    await expectRows(ui, [/^○ 기획$/, /^○ 조사$/, /^○ 설계$/, /^┆ 예정 1개 더$/, /^◉ 개발/, /^┆ 예정 2개 더$/, /^○ 공개$/])
    await ui.unmount()
  }
})

test('hidden steps before a group stay above it', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '묶음 앞',
      steps: [
        { id: 'a', label: 'a' },
        { id: 'b', label: 'b' },
        { id: 'c', label: 'c' },
        { id: 'd', label: 'd' },
        { id: 'e', label: 'e' },
        {
          id: 'g',
          label: 'G',
          children: [
            { id: 'g1', label: 'g1' },
            { id: 'g2', label: 'g2' },
          ],
        },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 'g1', status: 'doing' }))

  for (const surface of SURFACES) {
    // 이 모양을 보려고 높이를 14줄로 둔다. 40줄이면 늘린 모양을 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 14))
    await expectRows(ui, [/^○ a$/, /^○ b$/, /^○ c$/, /^┆ 예정 2개 더$/, /^◉ G/, /^├─◉ g1/, /^└─○ g2$/])
    await ui.unmount()
  }
})

test('hidden steps inside a group are counted between their neighbours', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '묶음 안',
      steps: [
        {
          id: 'g',
          label: 'G',
          children: [
            { id: 't1', label: 't1' },
            { id: 't2', label: 't2' },
            { id: 't3', label: 't3' },
            { id: 't4', label: 't4' },
            { id: 't5', label: 't5' },
            { id: 't6', label: 't6' },
            { id: 't7', label: 't7' },
          ],
        },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 't6', status: 'doing' }))

  // 숨는 것은 t4·t5 둘. 혼자가 아니라 개수로 둘 사이에 적는다.
  for (const surface of SURFACES) {
    // 이 모양을 보려고 높이를 10줄로 둔다. 40줄이면 늘린 모양을 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 10))
    await expectRows(ui, [/^◉ G/, /^├─○ t1$/, /^├─○ t2$/, /^├─○ t3$/, /^│ ┆ 예정 2개 더$/, /^├─◉ t6/, /^└─○ t7$/])
    await ui.unmount()
  }
})

test('finished steps do not split a run of hidden steps', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '책 만들기',
      steps: [
        { id: 'p1', label: '준비' },
        { id: 'p2', label: '작성' },
        { id: 'p3', label: '표' },
        { id: 'p4', label: '그림' },
        { id: 'p5', label: '요약' },
        { id: 'p6', label: '부록' },
        { id: 'p7', label: '색인' },
        { id: 'p8', label: '목차' },
        { id: 'p9', label: '참고' },
        { id: 'p10', label: '인쇄' },
      ],
    }),
  )
  // 색인·목차를 먼저 끝내고 1분 뒤 준비를 끝낸다. 가장 최근에 끝난 준비만 보이고 색인·목차는 숨는다.
  await $.tool.call(tool({ action: 'update', id: 'p7', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'p8', status: 'done' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'p1', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'p2', status: 'doing' }))

  // 숨긴 끝남(색인·목차)은 맨 위 "완료 2개 더"에 들고, 부록과 참고는 한 덩어리로 센다.
  for (const surface of SURFACES) {
    // 이 모양을 보려고 높이를 18줄로 둔다. 40줄이면 늘린 모양을 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 18))
    await expectRows(ui, [
      /^┆ 완료 2개 더$/,
      /^● 준비/,
      /^◉ 작성/,
      /^○ 표$/,
      /^○ 그림$/,
      /^○ 요약$/,
      /^┆ 예정 2개 더$/,
      /^○ 인쇄$/,
    ])
    await ui.unmount()
  }
})

// 자리마다 개수 줄을 두면 줄이 늘 수 있다. 무엇으로도 모자라면 끝으로 숨긴 예정을 개수 줄 하나로 합쳐 넘치지 않게 한다.
test('the shortest shape puts all hidden steps in one count so nothing scrolls', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(SKIP))
  await $.tool.call(tool({ action: 'update', id: 'p5', status: 'doing' }))

  // 5줄: 머리 3 + 개발·개수 2.
  let ui = await $.ui.mount(pane('terminal', 40, 5))
  await expectRows(ui, [/^◉ 개발/, /^┆ 예정 7개 더$/])
  await ui.unmount()

  // 묶음 안의 숨긴 예정도 하나로 합친다. 6줄: 머리 3 + G·t5·개수 3.
  // 합친 개수는 맨 위 줄이라 묶음이 목록 끝이 아니므로 가지는 ├─ 이다.
  await $.tool.call(
    tool({
      action: 'plan',
      title: '묶음 안',
      steps: [
        {
          id: 'g',
          label: 'G',
          children: [
            { id: 't1', label: 't1' },
            { id: 't2', label: 't2' },
            { id: 't3', label: 't3' },
            { id: 't4', label: 't4' },
            { id: 't5', label: 't5' },
            { id: 't6', label: 't6' },
          ],
        },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 't5', status: 'doing' }))
  ui = await $.ui.mount(pane('terminal', 40, 6))
  await expectRows(ui, [/^◉ G/, /^├─◉ t5/, /^┆ 예정 5개 더$/])
  await ui.unmount()
})

test('when the final step is dropped the count closes the rail of the last group', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(tool(CHORES))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'g1', status: 'doing' }))

  // 8줄: 머리 3 + 준비·세로선·마무리·청소·개수 5. 끝 단계를 뺀 모양이 맞는다.
  // 청소는 마지막 가지(└─)이고, 그 뒤 개수 줄은 세로선 없이 들여 쓴다.
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface, 40, 8))
    await expectRows(ui, [/^● 준비/, /^◉ 마무리/, /^└─◉ 청소/, /^  ┆ 예정 5개 더$/])
    await ui.unmount()
  }
})

// ── 2026-11-25 검토에서 미룬 것: "개수 대신 그 단계"는 줄 수가 같을 때만 ──────────────

test('a lone finished step that would split the hidden steps is counted instead', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '책 만들기',
      steps: [
        { id: 'p', label: '준비' },
        { id: 'a', label: '자료' },
        { id: 'b', label: '목차' },
        { id: 'c', label: '초안' },
        { id: 'd', label: '본문' },
        { id: 'e1', label: '표1' },
        { id: 'e2', label: '표2' },
        { id: 'f', label: '그림' },
        { id: 'g1', label: '부록1' },
        { id: 'g2', label: '부록2' },
        { id: 'h', label: '인쇄' },
      ],
    }),
  )
  // 그림을 먼저, 준비를 나중에 끝낸다. 숨는 끝난 단계는 그림 하나지만, 그리면 표1·표2와 부록1·부록2가 나뉘어 2줄 는다.
  await $.tool.call(tool({ action: 'update', id: 'f', status: 'done' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'p', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'd', status: 'doing' }))

  for (const surface of SURFACES) {
    // 이 모양을 보려고 높이를 18줄로 둔다. 40줄이면 늘린 모양을 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 18))
    await expectRows(ui, [/^┆ 완료 1개 더$/, /^● 준비/, /^○ 자료$/, /^○ 목차$/, /^○ 초안$/, /^◉ 본문/, /^┆ 예정 4개 더$/, /^○ 인쇄$/])
    await ui.unmount()
  }
})

// 2026-11-25 검토에서 메운 빈칸: 그리면 줄이 느는 경우(그리지 않는 묶음의 단계)는 개수로 남고, 경계에서는 그린다.

test('a lone hidden step of a group not drawn stays a count', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '안 그리는 묶음',
      steps: [
        { id: 'a', label: '준비' },
        { id: 'b', label: 'b' },
        { id: 'c', label: 'c' },
        { id: 'd', label: 'd' },
        { id: 'g', label: '발표', children: [{ id: 'g1', label: '슬라이드' }] },
        { id: 'e', label: '뒷정리' },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))

  // 슬라이드를 그리면 발표 머리 줄까지 1줄이 는다.
  for (const surface of SURFACES) {
    // 이 모양을 보려고 높이를 14줄로 둔다. 40줄이면 늘린 모양을 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 14))
    await expectRows(ui, [/^◉ 준비/, /^○ b$/, /^○ c$/, /^○ d$/, /^┆ 예정 1개 더$/, /^○ 뒷정리$/])
    await ui.unmount()
  }
})

test('a lone finished step of a group not drawn stays a count', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '안 그리는 묶음 끝남',
      steps: [
        { id: 'g', label: '조사', children: [{ id: 'g1', label: '자료' }] },
        { id: 'a', label: '준비' },
        { id: 'b', label: 'b' },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 'g1', status: 'done' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'b', status: 'doing' }))

  for (const surface of SURFACES) {
    // 이 모양을 보려고 높이를 8줄로 둔다. 40줄이면 늘린 모양을 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 8))
    await expectRows(ui, [/^┆ 완료 1개 더$/, /^● 준비/, /^◉ b/])
    await ui.unmount()
  }
})

test('a lone finished step right before a drawn group splits nothing and is drawn', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '앞 묶음',
      steps: [
        { id: 'y', label: 'y' },
        { id: 'a', label: 'a' },
        { id: 'b', label: 'b' },
        { id: 'c', label: 'c' },
        { id: 'd', label: 'd' },
        { id: 'e', label: 'e' },
        { id: 'f', label: 'f' },
        { id: 'g', label: 'G', children: [{ id: 'g1', label: 'g1' }, { id: 'g2', label: 'g2' }] },
        { id: 'z', label: 'z' },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 'f', status: 'done' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'y', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'doing' }))
  await $.tool.call(tool({ action: 'update', id: 'g1', status: 'blocked' }))

  // f 앞은 숨긴 e, 뒤는 보이는 묶음 G라 덩어리가 나뉘지 않는다. e는 혼자 숨어 이름으로 그린다.
  for (const surface of SURFACES) {
    // 혼자 숨는 규칙을 보려고 높이를 22줄로 둔다. 40줄이면 늘린 모양이 모두 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 22))
    await expectRows(ui, [/^● y/, /^◉ a/, /^○ b$/, /^○ c$/, /^○ d$/, /^○ e$/, /^● f/, /^▲ G/, /^├─▲ g1/, /^├─○ g2$/, /^○ z$/])
    await ui.unmount()
  }
})

test('a lone hidden step at the end of the last group takes the closing branch', async ($, on) => {
  const w = world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '끝 묶음',
      steps: [
        { id: 'a', label: '준비' },
        {
          id: 'g',
          label: '마무리',
          children: [
            { id: 'g1', label: 'g1' },
            { id: 'g2', label: 'g2' },
            { id: 'g3', label: 'g3' },
            { id: 'g4', label: 'g4' },
            { id: 'g5', label: 'g5' },
            { id: 'g6', label: 'g6' },
          ],
        },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 'g6', status: 'done' }))
  await w.clock.advance(1 * MIN)
  await $.tool.call(tool({ action: 'update', id: 'a', status: 'done' }))
  await $.tool.call(tool({ action: 'update', id: 'g1', status: 'doing' }))

  // 끝 단계 g6이 끝나 숨고, 묶음 안 마지막 덩어리 g5 하나가 이름으로 그려지며 └─를 받는다.
  for (const surface of SURFACES) {
    // 이 모양을 보려고 높이를 13줄로 둔다. 40줄이면 늘린 모양을 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 13))
    await expectRows(ui, [/^┆ 완료 1개 더$/, /^● 준비/, /^◉ 마무리/, /^├─◉ g1/, /^├─○ g2$/, /^├─○ g3$/, /^├─○ g4$/, /^└─○ g5$/])
    await ui.unmount()
  }

  // 14줄이면 끝난 g6까지 그린다(12줄 + 명령 줄 자리 2줄). 끝난 것을 하나만 그린 모양(13줄)보다 짧지만 더 넉넉하므로 먼저 고른다.
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface, 40, 14))
    await expectRows(ui, [/^● 준비/, /^◉ 마무리/, /^├─◉ g1/, /^├─○ g2$/, /^├─○ g3$/, /^├─○ g4$/, /^├─○ g5$/, /^└─● g6/])
    await ui.unmount()
  }
})

test('a lone hidden step inside a shown group is drawn instead of counted', async ($, on) => {
  world(on)
  await $.session.start(START)
  await $.tool.call(
    tool({
      action: 'plan',
      title: '보고서 쓰기',
      steps: [
        {
          id: 'g',
          label: '조사',
          children: [
            { id: 'g1', label: '자료 찾기' },
            { id: 'g2', label: '읽기' },
            { id: 'g3', label: '요약' },
            { id: 'g4', label: '비교' },
            { id: 'g5', label: '정리' },
          ],
        },
        {
          id: 'h',
          label: '작성',
          children: [
            { id: 'h1', label: '초안' },
            { id: 'h2', label: '퇴고' },
          ],
        },
      ],
    }),
  )
  await $.tool.call(tool({ action: 'update', id: 'g1', status: 'doing' }))

  // 정리와 초안은 각자 묶음 안에서 혼자 숨는다. 묶음 머리가 이미 있으니 이름으로 그려도 줄 수가 같다.
  for (const surface of SURFACES) {
    // 혼자 숨는 규칙을 보려고 높이를 13줄로 둔다. 40줄이면 늘린 모양이 모두 그린다.
    const ui = await $.ui.mount(pane(surface, 40, 13))
    await expectRows(ui, [
      /^◉ 조사/,
      /^├─◉ 자료 찾기/,
      /^├─○ 읽기$/,
      /^├─○ 요약$/,
      /^├─○ 비교$/,
      /^├─○ 정리$/,
      /^○ 작성$/,
      /^├─○ 초안$/,
      /^└─○ 퇴고$/,
    ])
    await ui.unmount()
  }
})

// ── 2026-11-25 높이에 따라 늘리기 ─────────────────────────────────────────
// 자리가 남으면 예정부터 늘리고, 예정이 다 보이면 끝난 단계를 최근 것부터 늘린다(사용자가 고름).
// 늘린 모양은 명령 줄 2줄 자리를 더 둔다(사용자가 고름). 명령이 2줄 이하로 오가도 목록이 그대로다.
const GROW = {
  action: 'plan',
  title: '누리집 만들기',
  steps: [
    { id: 'a1', label: '기획' },
    { id: 'a2', label: '조사' },
    { id: 'a3', label: '설계' },
    { id: 'a4', label: '시안' },
    { id: 'b', label: '개발' },
    { id: 'c1', label: '화면' },
    { id: 'c2', label: '서버' },
    { id: 'c3', label: '연결' },
    { id: 'c4', label: '시험' },
    { id: 'c5', label: '문서' },
    { id: 'c6', label: '배포' },
    { id: 'c7', label: '공개' },
  ],
}

// 끝난 넷을 1분 간격으로 order 차례로 끝내고 개발을 시작한다.
async function growUnderway($: Kit, w: ReturnType<typeof world>, order = ['a1', 'a2', 'a3', 'a4']) {
  await $.session.start(START)
  await $.tool.call(tool(GROW))
  for (const id of order) {
    await $.tool.call(tool({ action: 'update', id, status: 'done' }))
    await w.clock.advance(1 * MIN)
  }
  await $.tool.call(tool({ action: 'update', id: 'b', status: 'doing' }))
}

const UPCOMING = [/^○ 화면$/, /^○ 서버$/, /^○ 연결$/, /^○ 시험$/, /^○ 문서$/, /^○ 배포$/, /^○ 공개$/]

test('a taller pane shows more upcoming steps before more finished ones', async ($, on) => {
  const w = world(on)
  await growUnderway($, w)

  // 줄 수: 기본(예정 3개) 18, 예정 4개 20, 예정 전부 22, 끝난 2개 24, 전부 26. 늘린 모양은 2줄이 더 있어야 고른다.
  const cases: [number, RegExp[]][] = [
    [21, [/^┆ 완료 3개 더$/, /^● 시안/, /^◉ 개발/, /^○ 화면$/, /^○ 서버$/, /^○ 연결$/, /^┆ 예정 3개 더$/, /^○ 공개$/]],
    [22, [/^┆ 완료 3개 더$/, /^● 시안/, /^◉ 개발/, /^○ 화면$/, /^○ 서버$/, /^○ 연결$/, /^○ 시험$/, /^┆ 예정 2개 더$/, /^○ 공개$/]],
    [24, [/^┆ 완료 3개 더$/, /^● 시안/, /^◉ 개발/, ...UPCOMING]],
    [26, [/^┆ 완료 2개 더$/, /^● 설계/, /^● 시안/, /^◉ 개발/, ...UPCOMING]],
    [28, [/^● 기획/, /^● 조사/, /^● 설계/, /^● 시안/, /^◉ 개발/, ...UPCOMING]],
    [40, [/^● 기획/, /^● 조사/, /^● 설계/, /^● 시안/, /^◉ 개발/, ...UPCOMING]],
  ]
  for (const surface of SURFACES) {
    for (const [rows, want] of cases) {
      const ui = await $.ui.mount(pane(surface, 40, rows))
      await expectRows(ui, want)
      await ui.unmount()
    }
  }
})

test('the finished steps added are the ones that ended last', async ($, on) => {
  const w = world(on)
  // 끝낸 차례: 시안 → 기획 → 설계 → 조사. 최근 둘은 조사와 설계이고 목록 차례로 그린다.
  await growUnderway($, w, ['a4', 'a1', 'a3', 'a2'])

  const ui = await $.ui.mount(pane('terminal', 40, 26))
  await expectRows(ui, [/^┆ 완료 2개 더$/, /^● 조사/, /^● 설계/, /^◉ 개발/, ...UPCOMING])
  await ui.unmount()
})

test('finished steps that ended at the same time are added from the later one in the list', async ($, on) => {
  world(on)
  await $.session.start(START)
  // 계획에서 끝남으로 받은 단계는 끝난 시각이 없어 모두 같다. 목록에서 뒤의 것(시안, 설계)부터 그린다.
  const done = new Set(['a1', 'a2', 'a3', 'a4'])
  await $.tool.call(
    tool({
      ...GROW,
      steps: GROW.steps.map(s => (done.has(s.id) ? { ...s, status: 'done' } : s.id === 'b' ? { ...s, status: 'doing' } : s)),
    }),
  )

  const ui = await $.ui.mount(pane('terminal', 40, 26))
  await expectRows(ui, [/^┆ 완료 2개 더$/, /^● 설계/, /^● 시안/, /^◉ 개발/, ...UPCOMING])
  await ui.unmount()
})

test('a running command does not change a grown pane', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await growUnderway($, w)
  const head = [/^┆ 완료 3개 더$/, /^● 시안/, /^◉ 개발/]
  const tail = [/^○ 화면$/, /^○ 서버$/, /^○ 연결$/, /^○ 시험$/, /^┆ 예정 2개 더$/, /^○ 공개$/]

  // 22줄: 예정 4개 모양(20줄)에 명령 줄 2줄 자리. 명령이 없든 1줄이든 2줄이든 같은 모양이다.
  let ui = await $.ui.mount(pane('terminal', 40, 22))
  await expectRows(ui, [...head, ...tail])
  await ui.unmount()

  let calls = await runBash($, w, '테스트 실행')
  ui = await $.ui.mount(pane('terminal', 40, 22))
  await expectRows(ui, [...head, /^┆ ▶ 테스트 실행$/, ...tail])
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)

  calls = await runBash($, w, '테스트 실행', '타입 검사')
  ui = await $.ui.mount(pane('terminal', 40, 22))
  await expectRows(ui, [...head, /^┆ ▶ 테스트 실행$/, /^┆ ▶ 타입 검사$/, ...tail])
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})

test('more than two command lines shrink a grown pane instead of scrolling', async ($, on) => {
  const w = world(on)
  slow(on, w, 'Bash')
  await growUnderway($, w)

  // 명령 3줄이면 예정 4개 모양은 23줄이라 넘친다. 기본 모양(18줄 + 3줄)으로 그린다.
  const calls = await runBash($, w, '테스트 실행', '타입 검사', '검증')
  const ui = await $.ui.mount(pane('terminal', 40, 22))
  await expectRows(ui, [
    /^┆ 완료 3개 더$/,
    /^● 시안/,
    /^◉ 개발/,
    /^┆ ▶ 테스트 실행$/,
    /^┆ ▶ 타입 검사$/,
    /^┆ ▶ 검증$/,
    /^○ 화면$/,
    /^○ 서버$/,
    /^○ 연결$/,
    /^┆ 예정 3개 더$/,
    /^○ 공개$/,
  ])
  await ui.unmount()
  await w.clock.advance(5 * SEC)
  await Promise.all(calls)
})
