// The Week view's done/planned figure (`.mrow .v.cmp`, #573) shares its class name with the
// Coach's comparison rows (coach.css `.cmp`: a rule line on top and 8px padding), and coach.css is
// loaded on every page. Checked in Chrome: every Week row's figure had a hairline over it and sat
// 8px off the bar's line. The Stats rule now resets both.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const strip = f => readFileSync(resolve(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (css, sel) => css.match(new RegExp('(^|})\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}'))?.[2] || ''

describe('Stats Week figures keep clear of the Coach .cmp rule', () => {
  it('the Coach rule is still there (or this guard can go)', () => {
    expect(rule(strip('src/coach.css'), '.cmp')).toMatch(/border-top/)
  })
  it('the Stats rule resets its border and padding', () => {
    const own = rule(strip('src/index.css'), '.mrow .v.cmp')
    expect(own).toMatch(/border-top:none/)
    expect(own).toMatch(/padding:0/)
  })
})
