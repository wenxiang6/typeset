/**
 * 排版引擎 Playwright 冒烟回归
 *
 * 运行：
 *   pnpm smoke
 *   PAIBAN_URL=http://127.0.0.1:5173/ pnpm smoke
 *
 * 覆盖：
 * - 初始版面完整性（元素不消失、不出界、不重叠）
 * - 拖动避让：被压内容下推、溢出分页，元素总数不变
 * - 拖出页底：只移动当前组件到下一页
 * - 文字变长：自动增高、下推、溢出翻页
 * - 横版 ↔ 竖版往返：尺寸/双栏/页脚/元素数量正确
 * - 新增组件：自动对齐栏位、不重叠、超出自动分页
 * - 新增/删除页面：页脚页码自动更新
 * - 单块移到下一页
 * - 打印媒体：工具栏隐藏、纸张尺寸跟随横竖版
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  ARTIFACT_DIR,
  assert,
  assertInvariants,
  closeBrowser,
  dragElement,
  ensureServer,
  findElementPage,
  launchBrowser,
  openEditor,
  pageRect,
  readMaxGap,
  readState,
  resetEditor,
  screenshot,
  sleep,
  waitSettled,
} from '../tools/browser-utils.mjs'

const results = []
const started = Date.now()

async function test(name, fn) {
  const t = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - t })
    console.log(`✓ ${name} (${Date.now() - t}ms)`)
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t, error: err.message })
    console.error(`✗ ${name}\n  ${err.message}`)
    throw err
  }
}

const server = await ensureServer()
const { browser, executablePath } = await launchBrowser()
console.log(`浏览器：${executablePath ?? 'Playwright 默认 Chromium'}`)
const { page, logs } = await openEditor(browser)

try {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true })

  let baseline = null

  await test('初始版面完整（自动字号/自动分页后）', async () => {
    baseline = await readState(page)
    assert(baseline.total >= 68, `初始元素数异常偏少：${baseline.total}`)
    assert(baseline.pages >= 2, `初始页数异常偏少：${baseline.pages}`)
    assert(Math.abs(baseline.w - 1122.52) < 1 && Math.abs(baseline.h - 793.7) < 1, `A4 横版尺寸错误：${baseline.w}×${baseline.h}`)
    assertInvariants(baseline, '初始版面')
    await screenshot(page, '01-baseline.png')
  })

  await test('组件库扩展：53 种 + 搜索 + 新组件渲染', async () => {
    await resetEditor(page)
    await page.evaluate(() => localStorage.removeItem('paiban-frequent-components'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitSettled(page)
    const count = await page.locator('.ed-palette-item').count()
    assert(count >= 40, `组件库数量不足：${count}`)
    const groupTitles = await page.locator('.ed-palette-group-title').allTextContents()
    assert(groupTitles[0].startsWith('常用'), `常用组件没有置顶：${groupTitles.slice(0, 2).join(' / ')}`)
    const missing = await page.evaluate(() => {
      const d = window.__paibanApi.doc
      const docVariants = [...new Set(d.pages.flatMap((p) => p.els.map((e) => e.variant)))]
      const palette = new Set([...document.querySelectorAll('.ed-palette-item')].map((n) => n.getAttribute('data-variant')))
      return docVariants.filter((v) => !palette.has(v))
    })
    assert(missing.length === 0, `项目里的组件在组件库中没有对应项：${missing.join(' / ')}`)
    const cols4 = await page.evaluate(() => getComputedStyle(document.querySelector('.ed-palette-grid')).gridTemplateColumns.split(' ').length)
    assert(cols4 === 4, `默认应为 4 列，实际 ${cols4}`)
    await page.locator('.ed-palette-cols button', { hasText: '5' }).click()
    await sleep(150)
    const cols5 = await page.evaluate(() => getComputedStyle(document.querySelector('.ed-palette-grid')).gridTemplateColumns.split(' ').length)
    assert(cols5 === 5, `切换后应为 5 列，实际 ${cols5}`)
    await page.locator('.ed-palette-cols button', { hasText: '4' }).click()
    const search = page.locator('.ed-palette-search input')
    await search.fill('表格')
    await sleep(200)
    const filtered = await page.locator('.ed-palette-item').allTextContents()
    assert(filtered.length === 1 && filtered[0].includes('表格'), `搜索“表格”结果错误：${filtered.join(' / ')}`)
    await page.locator('.ed-palette-item', { hasText: '表格' }).first().click()
    await waitSettled(page)
    const hasTable = await page.evaluate(() => !!document.querySelector('.w-table table'))
    assert(hasTable, '表格组件没有渲染')
    const highlighted = await page.locator('.ed-palette-item.is-selected-component[data-variant="table"]').count()
    assert(highlighted >= 1, '选中的表格没有在组件库中高亮对应项')
    await page.locator('.ed-palette-search button').click()
    await sleep(150)
    const afterClear = await page.locator('.ed-palette-item').count()
    assert(afterClear === count + 1, `常用区没有动态加入表格：${count} → ${afterClear}`)
    const common = await page.locator('.ed-palette-group').first().locator('.ed-palette-item').allTextContents()
    assert(common.some((x) => x.includes('表格')), `常用区没有表格：${common.join(' / ')}`)
    // 已经存在时不重复 push
    await page.locator('.ed-palette-item', { hasText: '表格' }).first().click()
    await sleep(200)
    const commonAgain = await page.locator('.ed-palette-group').first().locator('.ed-palette-item').allTextContents()
    assert(commonAgain.filter((x) => x.includes('表格')).length === 1, `常用区重复 push：${commonAgain.join(' / ')}`)
    assertInvariants(await readState(page), '新增表格组件后')
    await screenshot(page, '00-palette.png')
  })

  await test('表格组件：改单元格、加行加列', async () => {
    await resetEditor(page)
    if (process.env.PAIBAN_DBG) console.log('AFTER-RESET', JSON.stringify(await page.evaluate(() => ({ pages: window.__paibanApi.doc.pages.length, total: window.__paibanApi.doc.pages.reduce((n,p)=>n+p.els.length,0), tables: window.__paibanApi.doc.pages.flatMap(p=>p.els).filter(e=>String(e.html||'').includes('<table')).map(e=>e.id) }))))
    await page.locator('.ed-palette-search input').fill('表格')
    await sleep(200)
    await page.locator('.ed-palette-item', { hasText: '表格' }).click()
    await waitSettled(page)
    const before = await page.evaluate(() => {
      const api = window.__paibanApi
      const id = api.selection
      const table = document.querySelector(`[data-el-id="${id}"] table`)
      return { id, rows: table.querySelectorAll('tbody tr').length, cols: table.querySelectorAll('thead th').length, tools: !!document.querySelector('.ed-table-tools') }
    })
    assert(before.tools, '表格没有行列编辑器')
    assert(before.rows === 3 && before.cols === 3, `初始表格尺寸错误：${before.rows}×${before.cols}`)
    const blank = await page.evaluate(() => [...document.querySelectorAll('.ed-v-table th, .ed-v-table td')].every((c) => !(c.textContent || '').trim()))
    assert(blank, '新建表格不应带示例内容')
    const cell = page.locator('.ed-table-editor input').nth(4)
    await cell.fill('测试海温')
    await sleep(300)
    const cellText = await page.evaluate(() => document.querySelector('[data-el-id="' + window.__paibanApi.selection + '"] tbody td:nth-child(2)')?.textContent)
    assert(cellText === '测试海温', `表格单元格没有更新：${cellText}`)
    await page.locator('.ed-table-tools button', { hasText: '＋ 列' }).click()
    await sleep(250)
    const lastRowH = await page.evaluate(() => {
      const id = window.__paibanApi.selection
      const rows = document.querySelectorAll(`[data-el-id="${id}"] tbody tr`)
      return rows[rows.length - 1]?.getBoundingClientRect().height ?? 0
    })
    await page.locator('.ed-table-tools button', { hasText: '＋ 行' }).click()
    await sleep(600)
    const after = await page.evaluate(() => {
      const id = window.__paibanApi.selection
      const table = document.querySelector(`[data-el-id="${id}"] table`)
      const rows = [...table.querySelectorAll('tbody tr')]
      return { rows: rows.length, cols: table.querySelectorAll('thead th').length, label: document.querySelector('.ed-table-tools span')?.textContent, lastTwo: rows.slice(-2).map((r) => r.getBoundingClientRect().height) }
    })
    assert(after.lastTwo.length === 2 && Math.abs(after.lastTwo[0] - after.lastTwo[1]) < 2, `新增行没有沿用上一行行高：${after.lastTwo.join(' / ')} (上上行 ${lastRowH})`)
    assert(after.rows === 4 && after.cols === 4, `加行加列失败：${JSON.stringify(after)}`)
    assert(after.label.includes('4 行 × 4 列'), `行列数显示错误：${after.label}`)
    // 鼠标拖列线 / 行线
    const vh = page.locator('.ed-th-v').first()
    const vb = await vh.boundingBox()
    assert(vb, '表格没有列宽拖拽把手')
    await page.mouse.move(vb.x + vb.width / 2, vb.y + 20)
    await page.mouse.down()
    await page.mouse.move(vb.x + vb.width / 2 + 36, vb.y + 20, { steps: 8 })
    await page.mouse.up()
    await sleep(500)
    const widths = await page.evaluate(() => [...document.querySelectorAll('col')].map((c) => parseFloat(c.style.width)))
    assert(widths.length === 4 && widths[0] > 25.5, `列宽拖动没有生效：${widths.join('/')}`)
    const headBefore = await page.evaluate(() => document.querySelector('thead tr').getBoundingClientRect().height)
    const hh = page.locator('.ed-th-h').first()
    const hb = await hh.boundingBox()
    assert(hb, '表格没有行高拖拽把手')
    await page.mouse.move(hb.x + 24, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x + 24, hb.y + hb.height / 2 + 16, { steps: 6 })
    await page.mouse.up()
    await sleep(500)
    const headAfter = await page.evaluate(() => document.querySelector('thead tr').getBoundingClientRect().height)
    assert(headAfter > headBefore + 10, `行高拖动没有生效：${headBefore} → ${headAfter}`)
    assertInvariants(await readState(page), '表格拖拽行列后')
    await screenshot(page, '02i-table.png')
  })

  await test('页脚组件可从组件库添加', async () => {
    await resetEditor(page)
    await page.locator('.ed-palette-item', { hasText: '页脚' }).click()
    await waitSettled(page)
    const info = await page.evaluate(() => {
      const api = window.__paibanApi
      const id = api.selection
      const el = id ? api.findEl(id) : null
      const node = id ? document.querySelector(`[data-el-id="${id}"]`) : null
      return {
        title: document.querySelector('.ed-insp-title')?.textContent || '',
        variant: el?.variant,
        y: el?.y,
        h: el?.h,
        pageH: api.doc.h,
        footerText: node?.querySelector('.footer')?.textContent || '',
      }
    })
    assert(info.variant === 'footer', `添加的不是页脚：${JSON.stringify(info)}`)
    assert(info.title.includes('页脚'), `属性栏没有显示页脚：${info.title}`)
    assert(Math.abs(info.y - (info.pageH - 60.5)) < 2, `页脚没有落在页底：${info.y}`)
    assert(info.footerText.includes('尺幅千里'), '页脚内容为空')
    assertInvariants(await readState(page), '添加页脚后')
    await screenshot(page, '02l-footer.png')
  })

  await test('页眉组件可从组件库添加', async () => {
    await resetEditor(page)
    await page.locator('.ed-palette-search input').fill('页眉')
    await sleep(200)
    await page.locator('.ed-palette-item', { hasText: '页眉' }).first().click()
    await waitSettled(page)
    const info = await page.evaluate(() => {
      const api = window.__paibanApi
      const id = api.selection
      const el = id ? api.findEl(id) : null
      const node = id ? document.querySelector(`[data-el-id="${id}"]`) : null
      return {
        title: document.querySelector('.ed-insp-title')?.textContent || '',
        variant: el?.variant,
        y: el?.y,
        h: el?.h,
        headerText: node?.querySelector('.header')?.textContent || '',
        headers: document.querySelectorAll('.ed-v-header').length,
      }
    })
    assert(info.variant === 'header', `添加的不是页眉：${JSON.stringify(info)}`)
    assert(info.title.includes('页眉'), `属性栏没有显示页眉：${info.title}`)
    assert(Math.abs(info.y - 37.8) < 2, `页眉没有落在页顶：${info.y}`)
    assert(info.headerText.includes('地理时政周刊'), '页眉内容为空')
    assert(info.headers === 3, `页眉数量异常（应每页一个）：${info.headers}`)
    assertInvariants(await readState(page), '添加页眉后')
    await screenshot(page, '02n-header.png')
  })

  await test('报头组件可从组件库添加', async () => {
    await resetEditor(page)
    await page.locator('.ed-palette-search input').fill('报头')
    await sleep(200)
    await page.locator('.ed-palette-item', { hasText: '报头' }).first().click()
    await waitSettled(page)
    const info = await page.evaluate(() => {
      const api = window.__paibanApi
      const id = api.selection
      const el = id ? api.findEl(id) : null
      return {
        title: document.querySelector('.ed-insp-title')?.textContent || '',
        variant: el?.variant,
        y: el?.y,
        mastheads: document.querySelectorAll('.ed-v-masthead').length,
      }
    })
    assert(info.variant === 'masthead', `添加的不是报头：${JSON.stringify(info)}`)
    assert(info.title.includes('报头'), `属性栏没有显示报头：${info.title}`)
    assert(info.y > 60 && info.y < 180, `报头没有落在页眉下方：${info.y}`)
    assert(info.mastheads === 1, `报头数量异常：${info.mastheads}`)
    assertInvariants(await readState(page), '添加报头后')
    await screenshot(page, '02o-masthead.png')
  })

  await test('常用组件最多 12 个，超出踢掉最后一个', async () => {
    await resetEditor(page)
    // 先清空历史常用，避免前序测试留下的页脚已在常用里导致“不 push”
    await page.evaluate(() => localStorage.removeItem('paiban-frequent-components'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitSettled(page)
    await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.ed-palette-item')]
        .map((n) => n.getAttribute('data-label'))
        .filter((x) => x && x !== '页脚')
        .slice(0, 12)
      localStorage.setItem('paiban-frequent-components', JSON.stringify(labels))
      location.reload()
    })
    await page.waitForFunction(() => !!window.__paibanApi)
    await waitSettled(page)
    const old = await page.evaluate(() => JSON.parse(localStorage.getItem('paiban-frequent-components') || '[]'))
    assert(old.length === 12, `常用初始数量应 12，实际 ${old.length}`)
    assert(!old.includes('页脚'), `测试初始化错误：页脚已在常用里 ${old.join(' / ')}`)
    await page.locator('.ed-palette-search input').fill('页脚')
    await sleep(200)
    await page.locator('.ed-palette-item', { hasText: '页脚' }).first().click()
    await sleep(500)
    const after = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('paiban-frequent-components') || '[]')
      const common = [...document.querySelectorAll('.ed-palette-group')][0]
      const labels = [...(common?.querySelectorAll('.ed-palette-item') ?? [])].map((n) => n.getAttribute('data-label'))
      return { stored, labels }
    })
    assert(after.stored.length === 12, `常用组件超过 12 个：${after.stored.length}`)
    assert(after.labels[0] === '页脚', `新用组件没有 push 到最前：${after.labels.join(' / ')}`)
    assert(!after.stored.includes(old[11]), `超限后没有踢掉最后一个：${old[11]}`)
    assert(JSON.stringify(after.stored) === JSON.stringify(['页脚', ...old.slice(0, 11)]), `常用顺序错误：${after.stored.join(' / ')}`)
    assert(after.stored.length === new Set(after.stored).size, '常用组件出现重复')
  })

  await test('有序 / 无序列表：模板切换与条目编辑', async () => {
    await resetEditor(page)
    await page.locator('.ed-palette-search input').fill('无序列表')
    await sleep(200)
    await page.locator('.ed-palette-item', { hasText: '无序列表' }).click()
    await waitSettled(page)
    const before = await page.evaluate(() => ({
      title: document.querySelector('.ed-insp-title')?.textContent || '',
      tag: document.querySelector('.ed-slot > .w-list')?.tagName,
      style: document.querySelector('.ed-slot > .w-list')?.getAttribute('data-list-style'),
      items: document.querySelectorAll('.ed-list-item').length,
    }))
    assert(before.tag === 'UL' && before.style === 'disc', `无序列表默认模板错误：${JSON.stringify(before)}`)
    assert(before.title.includes('无序列表') && before.items === 3, `无序列表属性/条目错误：${JSON.stringify(before)}`)
    await page.locator('.ed-list-templates button', { hasText: '卡片' }).click()
    await waitSettled(page)
    const cards = await page.evaluate(() => document.querySelector('.ed-slot > .w-list')?.getAttribute('data-list-style'))
    assert(cards === 'cards', `列表模板没有切换：${cards}`)
    await page.locator('.ed-list-item input').first().fill('测试条目')
    await page.locator('.ed-insp-row button', { hasText: '＋ 列表项' }).click()
    await waitSettled(page)
    const items = await page.evaluate(() => ({
      count: document.querySelectorAll('.ed-slot > .w-list > li').length,
      first: document.querySelector('.ed-slot > .w-list > li')?.textContent,
    }))
    assert(items.count === 4 && items.first === '测试条目', `列表条目编辑失败：${JSON.stringify(items)}`)
    await page.locator('.ed-list-type button', { hasText: '有序列表' }).click()
    await waitSettled(page)
    const ordered = await page.evaluate(() => ({
      tag: document.querySelector('.ed-slot > .w-list')?.tagName,
      title: document.querySelector('.ed-insp-title')?.textContent || '',
      templates: document.querySelectorAll('.ed-list-templates button').length,
    }))
    assert(ordered.tag === 'OL' && ordered.title.includes('有序列表'), `列表类型切换失败：${JSON.stringify(ordered)}`)
    assert(ordered.templates === 8, `有序列表模板数量错误：${ordered.templates}`)
    await page.locator('.ed-list-templates button', { hasText: '带圈数字' }).click()
    await waitSettled(page)
    const circled = await page.evaluate(() => document.querySelector('.ed-slot > .w-list')?.getAttribute('data-list-style'))
    assert(circled === 'circle-number', `带圈数字模板没有生效：${circled}`)
    assertInvariants(await readState(page), '列表模板编辑后')
    await screenshot(page, '02m-list.png')
  })

  await test('逻辑链：加节点自动补箭头', async () => {
    await resetEditor(page)
    await page.locator('.ed-palette-search input').fill('逻辑链')
    await sleep(200)
    await page.locator('.ed-palette-item', { hasText: '逻辑链' }).first().click()
    await waitSettled(page)
    const id = await page.evaluate(() => window.__paibanApi.selection)
    const before = await page.evaluate((id) => {
      const n = document.querySelector(`[data-el-id="${id}"]`)
      return {
        title: document.querySelector('.ed-insp-title')?.textContent || '',
        inputs: document.querySelectorAll('.ed-chain-item input').length,
        nodes: n?.querySelectorAll('.chain .node').length,
        arrows: n?.querySelectorAll('.chain .arrow').length,
      }
    }, id)
    assert(before.title.includes('逻辑链'), `属性栏没有显示逻辑链：${before.title}`)
    assert(before.inputs === 3 && before.nodes === 3 && before.arrows === 2, `逻辑链初始结构错误：${JSON.stringify(before)}`)
    await page.locator('.ed-chain-item input').first().fill('海温升高')
    await page.locator('.ed-insp-row button', { hasText: '＋ 节点' }).click()
    await waitSettled(page)
    const after = await page.evaluate((id) => {
      const n = document.querySelector(`[data-el-id="${id}"]`)
      return {
        inputs: document.querySelectorAll('.ed-chain-item input').length,
        nodes: n?.querySelectorAll('.chain .node').length,
        arrows: n?.querySelectorAll('.chain .arrow').length,
        text: [...(n?.querySelectorAll('.chain .node') ?? [])].map((x) => x.textContent),
      }
    }, id)
    assert(after.inputs === 4 && after.nodes === 4 && after.arrows === 3, `加节点没有自动补箭头：${JSON.stringify(after)}`)
    assert(after.text[0] === '海温升高', `逻辑链节点编辑失败：${after.text.join(' / ')}`)
    assertInvariants(await readState(page), '逻辑链编辑后')
    await screenshot(page, '02p-chain.png')
  })

  await test('页眉/页脚修改同步所有页', async () => {
    await resetEditor(page)
    await page.evaluate(() => {
      window.__paibanApi.updateEl(
        'p0-0',
        {
          html: '<div class="header"><div class="header-left"><div class="header-title">同步页眉</div></div><div class="header-right"><div class="issue">SYNC</div><div>2026.10.25</div></div></div>',
        },
        true,
      )
    })
    await page.waitForTimeout(500)
    const headers = await page.evaluate(() => [...document.querySelectorAll('.ed-v-header .header')].map((n) => n.textContent || ''))
    assert(headers.length === 3 && headers.every((x) => x.includes('同步页眉')), `页眉没有同步：${headers.join(' / ')}`)
    await page.evaluate(() => window.__paibanApi.updateStyle('p0-49', { lineWidth: '4px' }))
    await page.waitForTimeout(500)
    const footers = await page.evaluate(() => ({
      count: document.querySelectorAll('.ed-v-footer').length,
      borders: [...document.querySelectorAll('.ed-v-footer .footer')].map((n) => getComputedStyle(n).borderTopWidth),
      numbers: [...document.querySelectorAll('.ed-v-footer .footer .center')].map((n) => n.textContent),
    }))
    assert(footers.count === 3, `页脚数量错误：${footers.count}`)
    assert(footers.borders.every((x) => x === '4px'), `页脚线宽没有同步：${footers.borders.join(' / ')}`)
    assert(footers.numbers[0]?.includes('1 / 3') && footers.numbers[1]?.includes('2 / 3') && footers.numbers[2]?.includes('3 / 3'), `页脚页码错误：${footers.numbers.join(' / ')}`)
    assertInvariants(await readState(page), '页眉页脚同步后')
    await screenshot(page, '02r-sync.png')
  })

  await test('模板库：保存 / 应用 / 分享 / 导入', async () => {
    await resetEditor(page)
    await page.evaluate(() => localStorage.removeItem('paiban-templates-v1'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitSettled(page)
    const before = await readState(page)

    await page.locator('.ed-template-trigger').click()
    await sleep(200)
    const defaultCard = await page.locator('.ed-template-card').first().innerText()
    assert(defaultCard.includes('默认模板') && defaultCard.includes('内置'), `默认模板不是第一个：${defaultCard}`)
    await page.locator('.ed-template-save input').fill('自动化模板')
    await page.locator('.ed-template-save button', { hasText: '保存当前布局为模板' }).click()
    await sleep(700)
    const saved = await page.evaluate(() => ({
      cards: document.querySelectorAll('.ed-template-card').length,
      local: JSON.parse(localStorage.getItem('paiban-templates-v1') || '[]').length,
      msg: document.querySelector('.ed-template-message')?.textContent || '',
    }))
    assert(saved.cards === 2 && saved.local === 1, `模板保存失败：${JSON.stringify(saved)}`)
    assert(saved.msg.includes('已保存'), `模板保存没有提示：${saved.msg}`)
    await page.locator('.ed-template-close').click()

    // 改动当前布局后再应用模板，应回到保存时的布局
    await page.locator('.ed-palette-search input').fill('表格')
    await sleep(200)
    await page.locator('.ed-palette-item', { hasText: '表格' }).first().click()
    await waitSettled(page)
    const changed = await readState(page)
    assert(changed.total > before.total, '测试准备失败：没有改动布局')
    await page.locator('.ed-template-trigger').click()
    await page.locator('.ed-template-card', { hasText: '自动化模板' }).locator('button', { hasText: '应用' }).click()
    await sleep(700)
    const restored = await readState(page)
    assert(restored.total === before.total, `应用模板后元素数不一致：${before.total} → ${restored.total}`)

    // 分享文件
    await page.locator('.ed-template-trigger').click()
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 })
    await page.locator('.ed-template-card', { hasText: '自动化模板' }).locator('button', { hasText: '分享' }).click()
    const download = await downloadPromise
    const file = await download.path()
    assert(file, '分享没有生成模板文件')
    const raw = await fs.readFile(file, 'utf8')
    const payload = JSON.parse(raw)
    assert(payload.format === 'paiban-template' && payload.name === '自动化模板', `分享文件格式错误：${raw.slice(0, 80)}`)
    assert(payload.doc?.pages?.length === before.pages, `分享模板页数错误：${payload.doc?.pages?.length}`)

    // 导入刚分享的文件
    await page.locator('.ed-template-foot input[type="file"]').setInputFiles({
      name: '自动化模板.paiban.json',
      mimeType: 'application/json',
      buffer: Buffer.from(raw),
    })
    await sleep(500)
    const imported = await page.evaluate(() => ({
      cards: document.querySelectorAll('.ed-template-card').length,
      names: [...document.querySelectorAll('.ed-template-name')].map((n) => n.textContent),
      msg: document.querySelector('.ed-template-message')?.textContent || '',
    }))
    assert(imported.cards === 3, `模板导入失败：${imported.cards}`)
    assert(imported.msg.includes('已导入'), `模板导入没有提示：${imported.msg}`)
    await screenshot(page, '02q-templates.png')
    await page.locator('.ed-template-close').click()
  })

  await test('底色作用于组件内容表面', async () => {
    await resetEditor(page)
    await page.locator('[data-el-id="p0-5"]').click()
    await sleep(250)
    const colors = page.locator('.ed-field', { hasText: '底色' }).locator('.ed-colors i')
    await colors.nth(3).click()
    await sleep(350)
    const filled = await page.evaluate(() => {
      const n = document.querySelector('[data-el-id="p0-5"]')
      const child = n.querySelector('.note')
      return { cls: n.className, elBg: getComputedStyle(n).backgroundColor, childBg: getComputedStyle(child).backgroundColor, active: document.querySelectorAll('.ed-field .ed-colors i.is-on').length }
    })
    assert(filled.cls.includes('has-custom-bg'), '底色没有作用到组件')
    assert(filled.childBg === 'rgb(102, 102, 102)', `提示框内容表面没有变色：${filled.childBg}`)
    assert(filled.active === 1, `色块没有选中态：${filled.active}`)

    await colors.first().click()
    await sleep(300)
    const transparent = await page.evaluate(() => getComputedStyle(document.querySelector('[data-el-id="p0-5"] .note')).backgroundColor)
    assert(transparent === 'rgba(0, 0, 0, 0)', `透明底色没有生效：${transparent}`)

    await page.locator('.ed-color-pick input').fill('#ffcc00')
    await sleep(350)
    const custom = await page.evaluate(() => getComputedStyle(document.querySelector('[data-el-id="p0-5"] .note')).backgroundColor)
    assert(custom === 'rgb(255, 204, 0)', `自定义底色没有生效：${custom}`)
    assertInvariants(await readState(page), '设置底色后')
    await screenshot(page, '02f-bg.png')
  })

  await test('二维码框可更换二维码图片', async () => {
    await resetEditor(page)
    await page.locator('.ed-palette-search input').fill('二维码')
    await sleep(200)
    await page.locator('.ed-palette-item', { hasText: '二维码框' }).click()
    await waitSettled(page)
    const qr = await page.evaluate(() => {
      const id = window.__paibanApi.selection
      const n = document.querySelector(`[data-el-id="${id}"] .w-qr .code`)
      return {
        id,
        title: document.querySelector('.ed-insp-title')?.textContent || '',
        hasInput: !!document.querySelector('.ed-inspector input[placeholder*="二维码图片地址"]'),
        bg: n ? getComputedStyle(n).backgroundImage : '',
      }
    })
    assert(qr.title.includes('二维码框'), `二维码框属性标题错误：${qr.title}`)
    assert(qr.hasInput, '二维码框没有图片地址输入框')
    const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" fill="#123456"/></svg>').toString('base64')
    await page.locator('.ed-inspector input[placeholder*="二维码图片地址"]').fill(svg)
    await sleep(400)
    const qrImage = await page.evaluate((id) => {
      const code = document.querySelector(`[data-el-id="${id}"] .w-qr .code`)
      return { bg: getComputedStyle(code).backgroundImage, img: code.querySelector('img')?.getAttribute('src') || '' }
    }, qr.id)
    assert(qrImage.bg.includes('data:image/svg+xml'), `二维码背景图没有替换：${qrImage.bg.slice(0, 80)}`)
    assert(qrImage.img.startsWith('data:image/svg+xml'), '二维码没有生成真实 img 元素')
    assertInvariants(await readState(page), '更换二维码后')
    await screenshot(page, '02g-qr.png')
  })

  await test('线宽可调 + 页脚框与内容一致', async () => {
    await resetEditor(page)
    const ids = await page.evaluate(() => {
      const d = window.__paibanApi.doc
      const footer = d.pages[0].els.find((e) => e.variant === 'footer')
      const section = d.pages.flatMap((p) => p.els).find((e) => e.variant === 'section-title')
      window.__paibanApi.setSelection(footer.id)
      return { footer: footer.id, section: section.id }
    })
    await sleep(250)
    const before = await page.evaluate((id) => {
      const n = document.querySelector(`[data-el-id="${id}"]`)
      const slot = n.querySelector('.ed-slot')
      const child = n.querySelector('.footer')
      const box = n.getBoundingClientRect()
      const cr = child.getBoundingClientRect()
      return { boxTop: box.top, boxBottom: box.bottom, childTop: cr.top, childBottom: cr.bottom, scrollH: slot.scrollHeight, clientH: slot.clientHeight }
    }, ids.footer)
    assert(before.childTop >= before.boxTop - 1 && before.childBottom <= before.boxBottom + 1, `页脚内容跑出选择框：${JSON.stringify(before)}`)
    assert(before.scrollH <= before.clientH + 3, `页脚内容溢出框：${before.scrollH} > ${before.clientH}`)

    await page.evaluate((id) => window.__paibanApi.updateStyle(id, { lineWidth: '4px' }), ids.footer)
    await sleep(500)
    await waitSettled(page)
    const footer4 = await page.evaluate((id) => {
      const n = document.querySelector(`[data-el-id="${id}"]`)
      const child = n.querySelector('.footer')
      const box = n.getBoundingClientRect()
      const cr = child.getBoundingClientRect()
      return { border: getComputedStyle(child).borderTopWidth, boxTop: box.top, boxBottom: box.bottom, childTop: cr.top, childBottom: cr.bottom }
    }, ids.footer)
    assert(footer4.border === '4px', `页脚线宽没有生效：${footer4.border}`)
    assert(footer4.childTop >= footer4.boxTop - 1 && footer4.childBottom <= footer4.boxBottom + 1, `加粗线宽后页脚内容跑出框：${JSON.stringify(footer4)}`)

    await page.evaluate((id) => window.__paibanApi.updateStyle(id, { lineWidth: '6px' }), ids.section)
    await sleep(500)
    const sectionBorder = await page.evaluate((id) => {
      const n = document.querySelector(`[data-el-id="${id}"]`)
      return n ? getComputedStyle(n.querySelector('.section-title')).borderBottomWidth : null
    }, ids.section)
    assert(sectionBorder === '6px', `章节下划线线宽没有生效：${sectionBorder}`)
    assertInvariants(await readState(page), '调整线宽后')
    await screenshot(page, '02d-line-width.png')
  })

  await test('复合组件内部元素：单独改字体与位置', async () => {
    await resetEditor(page)
    await page.locator('[data-el-id="p0-1"]').click()
    await sleep(300)
    const parts = await page.locator('.ed-sub-list button').allTextContents()
    assert(parts.length >= 3, `报头内部元素数量不足：${parts.join(' / ')}`)
    await page.locator('.ed-sub-list button', { hasText: '期刊一' }).click()
    await sleep(250)
    const before = await page.evaluate(() => {
      const api = window.__paibanApi
      const kicker = document.querySelector('[data-el-id="p0-1"] .masthead .kicker')
      return { sub: api.subSelection, font: getComputedStyle(kicker).fontSize, h: api.findEl('p0-1').h }
    })
    assert(before.sub && before.sub.index === 0, `没有选中内部元素：${JSON.stringify(before.sub)}`)
    await page.locator('.ed-sub-controls select').nth(1).selectOption('22')
    await sleep(700)
    await waitSettled(page)
    const afterFont = await page.evaluate(() => {
      const api = window.__paibanApi
      const kicker = document.querySelector('[data-el-id="p0-1"] .masthead .kicker')
      const h1 = document.querySelector('[data-el-id="p0-1"] .masthead h1')
      return { font: getComputedStyle(kicker).fontSize, h1: getComputedStyle(h1).fontSize, h: api.findEl('p0-1').h, x: api.findEl('p0-1').x, y: api.findEl('p0-1').y }
    })
    assert(afterFont.font === '22px', `内部元素字号没有生效：${afterFont.font}`)
    assert(afterFont.h1 !== '22px', '改期刊一号字时误改了主标题')
    assert(afterFont.h > before.h, `内部元素变高后组件框没有长高：${before.h} → ${afterFont.h}`)
    await page.keyboard.press('ArrowDown')
    await sleep(250)
    const afterMove = await page.evaluate(() => {
      const api = window.__paibanApi
      const p = api.findEl('p0-1')
      const kicker = document.querySelector('[data-el-id="p0-1"] .masthead .kicker')
      return { x: p.x, y: p.y, top: getComputedStyle(kicker).top, offset: p.sub?.[String(api.subSelection.index)] }
    })
    assert(afterMove.x === afterFont.x && afterMove.y === afterFont.y, '方向键移动内部元素时把整个报头移走了')
    assert(afterMove.top === '1px', `内部元素位置没有微调：${afterMove.top}`)
    assert(afterMove.offset?.dy === 1, `内部元素偏移没有记录：${JSON.stringify(afterMove.offset)}`)

    // 画布上再点内部元素也能选中
    await page.locator('[data-el-id="p0-1"] .masthead h1').click()
    await sleep(200)
    const clicked = await page.evaluate(() => window.__paibanApi.subSelection)
    assert(clicked && clicked.index === 1, `画布内点选内部元素失败：${JSON.stringify(clicked)}`)
    await page.evaluate(() => window.__paibanApi.clearSubStyle('p0-1', 0))
    await sleep(300)
    const reset = await page.evaluate(() => {
      const kicker = document.querySelector('[data-el-id="p0-1"] .masthead .kicker')
      return { font: getComputedStyle(kicker).fontSize, sub: window.__paibanApi.findEl('p0-1').sub }
    })
    assert(reset.font === '16px', `重置内部元素样式失败：${reset.font}`)
    assertInvariants(await readState(page), '内部元素编辑后')
    await screenshot(page, '02h-inner.png')
  })

  await test('方向键与相邻组件交换位置（↑↓ 同栏 / ←→ 跨栏）', async () => {
    await resetEditor(page)
    const readLeft = () =>
      page.evaluate(() => {
        const d = window.__paibanApi.doc
        const mid = d.w / 2
        return d.pages[0].els
          .filter((e) => e.kind !== 'chrome' && e.x < mid)
          .sort((a, b) => a.y - b.y)
          .map((e) => ({ id: e.id, y: Math.round(e.y), h: Math.round(e.h) }))
      })
    const before = await readLeft()
    const cur = before[before.length - 1]
    const prev = before[before.length - 2]
    const bottom = cur.y + cur.h

    await page.evaluate((id) => window.__paibanApi.setSelection(id), cur.id)
    await sleep(220)
    await page.keyboard.press('ArrowUp')
    await sleep(450)
    const after = await readLeft()
    const a = after.find((e) => e.id === cur.id)
    const b = after.find((e) => e.id === prev.id)
    assert(a && b, '交换后元素丢失')
    assert(a.y === prev.y, `按 ↑ 应与上方组件换位：y=${a.y}，应为 ${prev.y}`)
    assert(a.y + a.h <= b.y + 0.5, `交换后两个组件重叠：${a.y}+${a.h} > ${b.y}`)
    assert(Math.abs(b.y + b.h - bottom) <= 1, `交换后总底边应保持不变：${b.y + b.h} 应为 ${bottom}`)

    await page.keyboard.press('ArrowDown')
    await sleep(450)
    const back = await readLeft()
    assert(back.find((e) => e.id === cur.id)?.y === cur.y, '按 ↓ 没有换回原位')
    assertInvariants(await readState(page), '方向键交换后')

    // 跨栏：左栏第一块按 → 换到右栏同高的那块
    const lr = await page.evaluate(() => {
      const d = window.__paibanApi.doc
      const mid = d.w / 2
      const body = d.pages[0].els.filter((e) => e.kind !== 'chrome')
      const left = body.filter((e) => e.x < mid).sort((a, b) => a.y - b.y)[0]
      const right = body.filter((e) => e.x >= mid).sort((a, b) => a.y - b.y)[0]
      return {
        left: { id: left.id, x: Math.round(left.x) },
        right: { id: right.id, x: Math.round(right.x) },
      }
    })
    await page.evaluate((id) => window.__paibanApi.setSelection(id), lr.left.id)
    await sleep(220)
    await page.keyboard.press('ArrowRight')
    await sleep(450)
    const nx = await page.evaluate((id) => Math.round(window.__paibanApi.doc.pages[0].els.find((e) => e.id === id).x), lr.left.id)
    assert(Math.abs(nx - lr.right.x) <= 1, `按 → 应换到右栏 x=${lr.right.x}，实际 ${nx}`)
    assertInvariants(await readState(page), '跨栏交换后')
    await screenshot(page, '02d-swap.png')
  })

  await test('组件名称识别 + Alt+方向键 1px / Alt+Shift 10px 微调', async () => {
    await resetEditor(page)
    await page.locator('[data-el-id="p0-3"]').click()
    await sleep(250)
    const title1 = await page.locator('.ed-insp-title').innerText()
    assert(title1.includes('正文'), `属性栏没有显示组件名：${title1}`)
    const x0 = await page.evaluate(() => window.__paibanApi.doc.pages.flatMap((p) => p.els).find((e) => e.id === 'p0-3')?.x ?? 0)
    await page.keyboard.press('Alt+ArrowRight')
    await sleep(200)
    const x1 = await page.evaluate(() => window.__paibanApi.doc.pages.flatMap((p) => p.els).find((e) => e.id === 'p0-3')?.x ?? 0)
    assert(Math.abs(x1 - x0 - 1) < 0.01, `Alt+方向键应移动 1px，实际 ${x1 - x0}`)
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await sleep(200)
    const x2 = await page.evaluate(() => window.__paibanApi.doc.pages.flatMap((p) => p.els).find((e) => e.id === 'p0-3')?.x ?? 0)
    assert(Math.abs(x2 - x1 - 10) < 0.01, `Alt+Shift+方向键应移动 10px，实际 ${x2 - x1}`)

    await page.locator('[data-el-id="p0-5"]').click()
    await sleep(200)
    const title2 = await page.locator('.ed-insp-title').innerText()
    assert(title2.includes('提示框'), `属性栏组件名错误：${title2}`)

    await page.locator('[data-el-id="p0-49"]').click()
    await sleep(200)
    const title3 = await page.locator('.ed-insp-title').innerText()
    assert(title3.includes('页脚'), `属性栏组件名错误：${title3}`)
    const fy0 = await page.evaluate(() => window.__paibanApi.doc.pages[0].els.find((e) => e.id === 'p0-49')?.y ?? 0)
    await page.keyboard.press('Alt+ArrowDown')
    await sleep(200)
    const fy1 = await page.evaluate(() => window.__paibanApi.doc.pages[0].els.find((e) => e.id === 'p0-49')?.y ?? 0)
    assert(Math.abs(fy1 - fy0 - 1) < 0.01, `页脚 Alt+方向键应移动 1px，实际 ${fy1 - fy0}`)
    assertInvariants(await readState(page), '方向键微调后')
    await screenshot(page, '02e-nudge.png')
  })

  await test('页眉 / 报头 / 页脚：锁定后仍可选中、可双击改文字，但拖不动', async () => {
    await resetEditor(page)
    // 导入的文档会把这三件设成 locked（初始模板没锁）：模拟这个状态
    await page.evaluate(() => {
      const d = window.__paibanApi.doc
      for (const e of d.pages[0].els) {
        if (['header', 'masthead', 'footer'].includes(e.variant)) window.__paibanApi.updateEl(e.id, { locked: true }, false)
      }
    })
    await waitSettled(page, 8000)

    for (const variant of ['header', 'masthead', 'footer']) {
      const id = await page.evaluate((v) => window.__paibanApi.doc.pages[0].els.find((e) => e.variant === v)?.id ?? null, variant)
      assert(!!id, `找不到 ${variant}`)
      await page.evaluate(() => window.__paibanApi.setSelection(null))
      const box = await page.locator(`.ed-el[data-el-id="${id}"]`).boundingBox()
      await page.mouse.click(box.x + 14, box.y + 8)
      await sleep(140)
      const sel = await page.evaluate(() => window.__paibanApi.selection)
      assert(sel === id, `${variant} 单击没有选中（selection=${sel}）`)

      // 锁定件不能拖：按住往下拖，位置必须不变
      const before = await page.evaluate((eid) => {
        const e = window.__paibanApi.doc.pages.flatMap((p) => p.els).find((x) => x.id === eid)
        return { x: e.x, y: e.y }
      }, id)
      await page.mouse.move(box.x + 14, box.y + 8)
      await page.mouse.down()
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(box.x + 14, box.y + 8 + 6 * i)
        await sleep(8)
      }
      await page.mouse.up()
      await waitSettled(page, 8000)
      const after = await page.evaluate((eid) => {
        const e = window.__paibanApi.doc.pages.flatMap((p) => p.els).find((x) => x.id === eid)
        return e ? { x: e.x, y: e.y } : null
      }, id)
      assert(after && Math.abs(after.y - before.y) < 0.5, `${variant} 不应被拖动：y ${before.y} → ${after?.y}`)
    }

    // 双击页眉 → 进入内容编辑
    const hid = await page.evaluate(() => window.__paibanApi.doc.pages[0].els.find((e) => e.variant === 'header')?.id)
    await page.evaluate(() => window.__paibanApi.setEditingId(null))
    await page.locator(`.ed-el[data-el-id="${hid}"]`).dblclick({ position: { x: 14, y: 8 } })
    await sleep(220)
    const editingId = await page.evaluate(() => window.__paibanApi.editingId)
    assert(editingId === hid, `页眉双击没有进入编辑（editingId=${editingId}）`)
    await page.keyboard.press('Escape')
    await sleep(150)
    await screenshot(page, '02c-furniture-select.png')
  })

  await test('内部元素列表竖排：一行一个', async () => {
    await resetEditor(page)
    await page.locator('.ed-el[data-el-id="p0-0"]').click()
    await sleep(220)
    const rects = await page.evaluate(() =>
      [...document.querySelectorAll('.ed-sub-list button')].map((b) => {
        const r = b.getBoundingClientRect()
        return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width) }
      }),
    )
    assert(rects.length >= 2, `内部元素按钮不足：${rects.length}`)
    assert(new Set(rects.map((r) => r.left)).size === 1, `内部元素不是竖排：${JSON.stringify(rects)}`)
    const tops = rects.map((r) => r.top)
    assert(tops.every((t, i) => i === 0 || t > tops[i - 1]), `内部元素没有纵向排列：${JSON.stringify(tops)}`)
    assert(new Set(rects.map((r) => r.w)).size === 1, '内部元素按钮宽度不一致（没有占满一行）')
  })

  await test('锁定高度的文字块：装不下自动长高，框够大则不缩回', async () => {
    await resetEditor(page)
    const id = await page.evaluate(
      () => window.__paibanApi.doc.pages[0].els.find((e) => e.kind === 'text' && e.variant === 'paragraph')?.id ?? null,
    )
    assert(!!id, '找不到段落组件')

    // 拖窄 + 锁高到 20px：内容装不下 → 必须自己长高
    await page.evaluate((eid) => window.__paibanApi.updateEl(eid, { w: 200, h: 20, autoHeight: false }, true), id)
    await waitSettled(page, 12000)
    const grew = await page.evaluate((eid) => {
      const e = window.__paibanApi.doc.pages.flatMap((p) => p.els).find((x) => x.id === eid)
      return e ? { h: Math.round(e.h), auto: e.autoHeight } : null
    }, id)
    assert(grew && grew.h > 40, `锁高文字块应自动长高，实际 h=${grew?.h}`)
    assert(grew.auto === false, '不应偷偷把锁高改回自适应')

    // 手动把框拉得比内容还高：不能被自动测量缩回去
    await page.evaluate((eid) => window.__paibanApi.updateEl(eid, { h: 300, autoHeight: false }, true), id)
    await waitSettled(page, 12000)
    const kept = await page.evaluate((eid) => {
      const e = window.__paibanApi.doc.pages.flatMap((p) => p.els).find((x) => x.id === eid)
      return e ? Math.round(e.h) : null
    }, id)
    assert(kept === 300, `框比内容高时应保持 300，实际 ${kept}`)
  })

  await test('移动报头不会清空第一页正文', async () => {
    await resetEditor(page)
    const before = await readState(page)
    await dragElement(page, 'p0-1', { dy: 200, steps: 20 })
    const after = await readState(page)
    assertInvariants(after, '移动报头后')
    assert(after.pages === before.pages, `移动报头后页数变化：${before.pages} → ${after.pages}`)
    assert(after.total === before.total, `移动报头后元素数变化：${before.total} → ${after.total}`)
    assert(after.pageStats[0].flow === before.pageStats[0].flow, '移动报头后第一页正文被搬走了')
    const mast = await page.evaluate(() => {
      const d = window.__paibanApi.doc
      const p0 = d.pages[0]
      const m = p0.els.find((e) => e.variant === 'masthead')
      const FURN = new Set(['header', 'masthead', 'footer'])
      const flow = p0.els.filter((e) => !(e.kind === 'chrome' && FURN.has(e.variant)) && e.kind !== 'region' && !e.background)
      return m ? { y: m.y, h: m.h, minY: Math.min(...flow.map((e) => e.y)) } : null
    })
    assert(mast && mast.y + mast.h <= mast.minY + 1, `报头与正文重叠：${JSON.stringify(mast)}`)
    await screenshot(page, '02b-masthead-safe.png')
  })

  await test('损坏存档自动修复：第一页正文被搬走可恢复', async () => {
    await resetEditor(page)
    const before = await page.evaluate(() => {
      const d = window.__paibanApi.doc
      const FURN = new Set(['header', 'masthead', 'footer'])
      const isFlow = (e) => !(e.kind === 'chrome' && FURN.has(e.variant)) && e.kind !== 'region' && !e.background
      return { flow: d.pages.reduce((s, p) => s + p.els.filter(isFlow).length, 0) }
    })
    await page.evaluate(() => {
      const d = JSON.parse(JSON.stringify(window.__paibanApi.doc))
      const FURN = new Set(['header', 'masthead', 'footer'])
      const isFlow = (e) => !(e.kind === 'chrome' && FURN.has(e.variant)) && e.kind !== 'region' && !e.background
      const p0 = d.pages[0]
      const p1 = d.pages[1]
      const moved = p0.els.filter(isFlow)
      p0.els = p0.els.filter((e) => !isFlow(e))
      p1.els.push(...moved)
      const mast = p0.els.find((e) => e.variant === 'masthead')
      if (mast) mast.y = 700
      d.version = 2
      localStorage.setItem('paiban-editor-doc-v1', JSON.stringify(d))
      location.reload()
    })
    await page.waitForFunction(() => !!window.__paibanApi)
    await waitSettled(page, 15000)
    const after = await page.evaluate(() => {
      const d = window.__paibanApi.doc
      const FURN = new Set(['header', 'masthead', 'footer'])
      const isFlow = (e) => !(e.kind === 'chrome' && FURN.has(e.variant)) && e.kind !== 'region' && !e.background
      const page0Flow = d.pages[0].els.filter(isFlow).length
      const flow = d.pages.reduce((s, p) => s + p.els.filter(isFlow).length, 0)
      const mast = d.pages[0].els.find((e) => e.variant === 'masthead')
      return { flow, page0Flow, mastY: mast?.y ?? 0 }
    })
    assert(after.page0Flow > 0, '修复后第一页仍没有正文')
    assert(after.flow === before.flow, `修复前后内容数不一致：${before.flow} → ${after.flow}`)
    assert(after.mastY < 120, `报头没有复位：y=${after.mastY}`)
    assertInvariants(await readState(page), '修复损坏存档后')
    await screenshot(page, '02c-repair.png')
  })

  await test('拖动避让：内容下推并分页，无元素消失', async () => {
    await resetEditor(page)
    const before = await readState(page)
    await dragElement(page, 'p0-6', { dy: 150, steps: 24 })
    const after = await readState(page)
    assertInvariants(after, '拖动避让后')
    assert(after.total >= before.total, `元素总数从 ${before.total} 变成 ${after.total}`)
    await screenshot(page, '02-drag-avoid.png')
  })

  await test('拖出页底：只把当前组件移到下一页', async () => {
    await resetEditor(page)
    const before = await readState(page)
    const fromPage = await findElementPage(page, 'p0-3')
    const rect = await pageRect(page, fromPage)
    await dragElement(page, 'p0-3', { pointerY: Math.min(rect.bottom + 60, 980), steps: 22 })
    const after = await readState(page)
    assertInvariants(after, '拖出页底后')
    assert(after.total >= before.total, `元素总数从 ${before.total} 变成 ${after.total}`)
    const where = await page.evaluate(() => {
      const d = window.__paibanApi.doc
      return d.pages.flatMap((p, pi) => p.els.filter((e) => e.id === 'p0-3').map((e) => ({ pi, y: e.y })))
    })
    assert(where.length === 1 && where[0].pi === fromPage + 1, `p0-3 应在第 ${fromPage + 2} 页，实际 ${JSON.stringify(where)}`)
    assert(where[0].y < 170, `p0-3 应在新页顶部，实际 y=${where[0].y}`)
    assert(after.pageIdx === fromPage + 1, `应自动切到新页，实际 pageIdx=${after.pageIdx}`)
  })

  await test('文字变长：自动增高、下推、溢出翻页', async () => {
    await resetEditor(page)
    const before = await readState(page)
    await page.evaluate(() => {
      const api = window.__paibanApi
      const text = '超强厄尔尼诺已经形成，海气相互作用导致全球气候异常，这是高考地理综合思维的核心考点。'.repeat(24)
      api.updateEl('p0-3', { html: `<p><span class="label">对接教材：</span>${text}</p>` }, true)
    })
    await waitSettled(page, 6000)
    const after = await readState(page)
    assertInvariants(after, '文字变长后')
    assert(after.total >= before.total, `元素总数从 ${before.total} 变成 ${after.total}`)
    const h = await page.evaluate(() => window.__paibanApi.doc.pages.flatMap((p) => p.els).find((e) => e.id === 'p0-3')?.h ?? 0)
    assert(h > 100, `文字块应自动增高到 100px 以上，实际 ${h}`)
    await screenshot(page, '03-autogrow.png')
  })

  await test('左栏溢出：先流到本页右栏（第 1 页也适用）', async () => {
    await resetEditor(page)
    const setup = await page.evaluate(() => {
      const api = window.__paibanApi
      const d = api.doc
      const contentW = d.w - 45.3 * 2
      const colW = (contentW - 14.1) / 2
      // 先放一个贴在左栏底部的图（addEl 会把尺寸夹进版心），再把高度撑到溢出
      const id = api.addEl(0, { kind: 'image', variant: 'image', src: '', x: 45.3, y: 700, w: Math.round(colW), h: 100 })
      api.updateEl(id, { h: 520 }, true)
      api.reflow()
      return { id }
    })
    await waitSettled(page, 15000)
    const info = await page.evaluate((id) => {
      const d = window.__paibanApi.doc
      return d.pages.flatMap((p, pi) => p.els.filter((e) => e.id === id).map((e) => ({ pi, x: e.x, w: e.w, y: e.y, dw: d.w })))
    }, setup.id)
    const st = await readState(page)
    assert(info.length === 1, '左栏溢出的组件丢失了')
    assert(info[0].pi === 0, `左栏溢出应先留在第 1 页，实际跑到第 ${info[0].pi + 1} 页`)
    assert(info[0].x + info[0].w / 2 > info[0].dw / 2, `左栏溢出应进入本页右栏，实际 x=${info[0].x}`)
    assertInvariants(st, '左栏溢出后')
    await screenshot(page, '03a-left-column-flow.png')
  })

  await test('右栏溢出：整块流到下一页左栏', async () => {
    await resetEditor(page)
    const setup = await page.evaluate(() => {
      const api = window.__paibanApi
      const d = api.doc
      const contentW = d.w - 45.3 * 2
      const colW = (contentW - 14.1) / 2
      const x = 45.3 + colW + 14.1
      const id = api.addEl(0, { kind: 'image', variant: 'image', src: '', x, y: 400, w: 200, h: 120 })
      return { id }
    })
    await waitSettled(page)
    const srcInfo = await page.evaluate((id) => {
      const d = window.__paibanApi.doc
      const found = d.pages.flatMap((p, pi) => p.els.filter((e) => e.id === id).map((e) => ({ pi, x: e.x, w: e.w, dw: d.w })))
      return found[0]
    }, setup.id)
    assert(!!srcInfo, '右栏测试组件没有创建成功')
    assert(srcInfo.x + srcInfo.w / 2 > srcInfo.dw / 2, `测试组件应在右栏，实际 x=${srcInfo.x}`)
    const before = await readState(page)
    // 把图片撑到比整栏还高，强制整块溢出（图片不参与按行切割）
    await page.evaluate((id) => {
      window.__paibanApi.updateEl(id, { h: 900 }, true)
      window.__paibanApi.reflow()
    }, setup.id)
    await waitSettled(page, 15000)
    const after = await readState(page)
    assertInvariants(after, '右栏溢出后')
    assert(after.total >= before.total, `元素总数从 ${before.total} 变成 ${after.total}`)
    const info = await page.evaluate((id) => {
      const d = window.__paibanApi.doc
      return d.pages.flatMap((p, pi) => p.els.filter((e) => e.id === id).map((e) => ({ pi, x: e.x, y: e.y, w: e.w, dw: d.w })))
    }, setup.id)
    assert(info.length === 1, '右栏溢出的组件丢失了')
    assert(info[0].pi === srcInfo.pi + 1, `右栏溢出应进入下一页，实际第 ${info[0].pi + 1} 页`)
    assert(info[0].x < info[0].dw / 2, `右栏溢出应进入左栏，实际 x=${info[0].x}`)
    assert((await readMaxGap(page)) <= 8, '溢出后页面没有自动补齐')
    await screenshot(page, '03b-right-column-flow.png')
  })

  await test('文字块跨页：按整行切开，续块进入下一页左栏', async () => {
    await resetEditor(page)
    await page.evaluate(() => window.__paibanApi.addPage())
    await waitSettled(page)
    const setup = await page.evaluate(() => {
      const api = window.__paibanApi
      const d = api.getDoc()
      const pi = d.pages.length - 1
      const contentW = d.w - 45.3 * 2
      const colW = (contentW - 14.1) / 2
      const x = 45.3 + colW + 14.1
      const id = api.addEl(pi, { kind: 'text', variant: 'paragraph', html: '<p>右栏文字切割测试</p>', x, y: 500, w: colW, h: 40 })
      return { id, pi }
    })
    await waitSettled(page)
    const srcInfo = await page.evaluate((id) => {
      const d = window.__paibanApi.doc
      const found = d.pages.flatMap((p, pi) => p.els.filter((e) => e.id === id).map((e) => ({ pi, x: e.x, w: e.w, dw: d.w })))
      return found[0]
    }, setup.id)
    assert(!!srcInfo, '文字切割测试元素没有创建成功')
    assert(srcInfo.x + srcInfo.w / 2 > srcInfo.dw / 2, `测试元素应在右栏，实际 x=${srcInfo.x}`)
    const beforeIds = await page.evaluate(() => window.__paibanApi.doc.pages.flatMap((p) => p.els.map((e) => e.id)))
    const text = '太平洋东岸海温异常升高，气流上升，降水激增，暴雨洪涝多发，秘鲁渔场因上升流减弱而严重减产。'.repeat(30)
    await page.evaluate(({ id, t }) => {
      window.__paibanApi.updateEl(id, { html: `<p><span class="label">右栏文字：</span>${t}</p>` }, true)
    }, { id: setup.id, t: text })
    await waitSettled(page, 18000)
    const after = await readState(page)
    assertInvariants(after, '文字切割后')
    const info = await page.evaluate((oldIds) => {
      const d = window.__paibanApi.doc
      const all = d.pages.flatMap((p, pi) => p.els.map((e) => ({ pi, id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, cont: !!e.continued, text: (e.html || '').replace(/<[^>]+>/g, '') })))
      return { w: d.w, added: all.filter((e) => !oldIds.includes(e.id)), cont: all.filter((e) => e.cont) }
    }, beforeIds)
    const newCont = info.added.filter((e) => e.cont)
    assert(newCont.length > 0, '文字跨页没有生成续块')
    const first = newCont[0]
    assert(first.pi === srcInfo.pi + 1, `续块应在源页下一页（第 ${srcInfo.pi + 2} 页），实际第 ${first.pi + 1} 页`)
    assert(first.x < info.w / 2, `续块应在左栏，实际 x=${first.x}`)
    assert(first.y < 260, `续块应在新页左栏上部，实际 y=${first.y}`)
    assert(first.text.length > 20, '续块文字过少，切割失败')
    await screenshot(page, '03c-text-split.png')
  })

  await test('跨页拖动：拖到其他页并自动补齐', async () => {
    await resetEditor(page)
    await page.evaluate(() => window.__paibanApi.setZoom(0.5))
    await sleep(400)
    const before = await readState(page)
    const fromPage = await findElementPage(page, 'p0-6')
    const targetPage = fromPage + 1 < before.pages ? fromPage + 1 : Math.max(0, fromPage - 1)
    await pageRect(page, fromPage)
    await dragElement(page, 'p0-6', { targetPage, targetRelX: 120, targetRelY: 120, steps: 30 })
    const after = await readState(page)
    assertInvariants(after, '跨页拖动后')
    assert(after.total === before.total, `跨页拖动不应增减元素，${before.total} → ${after.total}`)
    const where = await page.evaluate(() => {
      const d = window.__paibanApi.doc
      return d.pages.flatMap((p, pi) => p.els.filter((e) => e.id === 'p0-6').map((e) => ({ pi, x: e.x, y: e.y })))
    })
    assert(where.length === 1 && where[0].pi === targetPage, `组件应移动到第 ${targetPage + 1} 页，实际 ${JSON.stringify(where)}`)
    const gap = await readMaxGap(page)
    assert(gap <= 8, `原页没有自动补齐，最大空隙 ${gap}px`)
    assert(after.pageIdx === targetPage, `应切到目标页，实际 pageIdx=${after.pageIdx}`)
    await screenshot(page, '03d-cross-page.png')
  })

  await test('全屏背景：所有页铺满、跟随横竖版、新页继承', async () => {
    await resetEditor(page)
    const before = await readState(page)
    await page.locator('.ed-palette-item', { hasText: '全屏背景' }).first().click()
    await waitSettled(page)
    const added = await readState(page)
    assertInvariants(added, '插入背景后')
    assert(added.total >= before.total + before.pages, '背景图应添加到所有页')
    const bg = await page.evaluate(() => {
      const d = window.__paibanApi.doc
      return d.pages.map((p, pi) => {
        const b = p.els.find((e) => e.variant === 'bg-image')
        return b ? { pi, x: b.x, y: b.y, w: b.w, h: b.h, z: b.z, src: b.src } : null
      })
    })
    assert(bg.every(Boolean), '并非每一页都有全屏背景')
    assert(bg.every((b) => b.x === 0 && b.y === 0 && Math.abs(b.w - before.w) < 1 && Math.abs(b.h - before.h) < 1 && b.z < 0), '背景图没有铺满页面或没有置底')

    const bgId = await page.evaluate(() => window.__paibanApi.doc.pages[0].els.find((e) => e.variant === 'bg-image')?.id)
    await page.evaluate((id) => window.__paibanApi.updateEl(id, { src: '/images/img1.png' }, true), bgId)
    await page.evaluate(() => window.__paibanApi.setPageBackground('/images/img1.png'))
    await waitSettled(page)
    const loaded = await page.evaluate(() => {
      const img = document.querySelector('.ed-el.ed-v-bg-image img')
      return { nw: img?.naturalWidth ?? 0, src: img?.getAttribute('src') }
    })
    assert(loaded.nw > 0, `背景图片没有加载成功：${loaded.src}`)

    await page.evaluate(() => window.__paibanApi.setOrientation('portrait'))
    await waitSettled(page, 12000)
    const portraitBg = await page.evaluate(() => {
      const d = window.__paibanApi.doc
      return d.pages.map((p) => {
        const b = p.els.find((e) => e.variant === 'bg-image')
        return b ? { w: b.w, h: b.h, dw: d.w, dh: d.h } : null
      })
    })
    assert(portraitBg.every((b) => b && Math.abs(b.w - b.dw) < 1 && Math.abs(b.h - b.dh) < 1), '竖版后背景图没有铺满新纸张')

    await page.evaluate(() => window.__paibanApi.addPage())
    await waitSettled(page)
    const hasBg = await page.evaluate(() => {
      const d = window.__paibanApi.doc
      return d.pages[d.pages.length - 1].els.some((e) => e.variant === 'bg-image')
    })
    assert(hasBg, '新增页没有继承全屏背景')
    await screenshot(page, '06-background.png')
  })

  await test('横版 → 竖版 → 横版：内容不丢、不出界、不重叠', async () => {
    await resetEditor(page)
    const before = await readState(page)
    await page.evaluate(() => window.__paibanApi.setOrientation('portrait'))
    await waitSettled(page, 6000)
    const portrait = await readState(page)
    assertInvariants(portrait, '竖版')
    assert(portrait.w < portrait.h, `竖版尺寸错误：${portrait.w}×${portrait.h}`)
    assert(portrait.total >= before.total, `竖版元素数从 ${before.total} 变成 ${portrait.total}`)
    assert(portrait.pageStats.every((p) => p.footer && /\/\s*\d+/.test(p.footer)), '竖版页脚页码缺失')
    await screenshot(page, '04-portrait.png')

    await page.evaluate(() => window.__paibanApi.setOrientation('landscape'))
    await waitSettled(page, 6000)
    const back = await readState(page)
    assertInvariants(back, '切回横版')
    assert(back.w > back.h, `切回横版尺寸错误：${back.w}×${back.h}`)
    assert(back.total >= before.total, `切回横版元素数从 ${before.total} 变成 ${back.total}`)
  })

  await test('连续新增 5 个组件：自动对齐栏位、不重叠', async () => {
    await resetEditor(page)
    const before = await readState(page)
    const beforeIds = await page.evaluate(() => window.__paibanApi.doc.pages.flatMap((p) => p.els.map((e) => e.id)))
    const item = page.locator('.ed-palette-item', { hasText: '正文' }).first()
    for (let i = 0; i < 5; i++) {
      await item.click()
      await sleep(220)
    }
    await waitSettled(page)
    const after = await readState(page)
    assertInvariants(after, '连续新增后')
    assert(after.total >= before.total + 5, `元素数应至少为 ${before.total + 5}，实际 ${after.total}`)
    const added = await page.evaluate((oldIds) => {
      const ids = window.__paibanApi.doc.pages.flatMap((p) => p.els.map((e) => e.id))
      return ids.filter((id) => !oldIds.includes(id))
    }, beforeIds)
    assert(added.length >= 5, `新组件应有至少 5 个，实际 ${added.length}`)
  })

  await test('新增 / 删除页面：页脚页码自动更新', async () => {
    await resetEditor(page)
    const before = await readState(page)
    await page.evaluate(() => window.__paibanApi.addPage())
    await waitSettled(page)
    const added = await readState(page)
    const totalPages = before.pages + 1
    assert(added.pages === totalPages, `页数应 +1，实际 ${added.pages}`)
    const expected = Array.from({ length: totalPages }, (_, i) => `${i + 1} / ${totalPages}`).join(',')
    assert(added.footerLabels.join(',') === expected, `页脚页码错误：${added.footerLabels.join(',')}`)
    assert(added.total === before.total + 2, `新页应自动带页眉和页脚，实际元素 ${added.total}`)

    await page.evaluate((idx) => window.__paibanApi.removePage(idx), totalPages - 1)
    await waitSettled(page)
    const removed = await readState(page)
    assert(removed.pages === before.pages, `删除后页数应恢复，实际 ${removed.pages}`)
    const expectedBack = Array.from({ length: before.pages }, (_, i) => `${i + 1} / ${before.pages}`).join(',')
    assert(removed.footerLabels.join(',') === expectedBack, `删除后页脚页码错误：${removed.footerLabels.join(',')}`)
  })

  await test('单块移到下一页（属性面板同款能力）', async () => {
    await resetEditor(page)
    const before = await readState(page)
    await page.evaluate(() => window.__paibanApi.moveElToNextPage('p0-3'))
    await waitSettled(page)
    const after = await readState(page)
    assertInvariants(after, '单块翻页后')
    assert(after.total >= before.total, `元素总数从 ${before.total} 变成 ${after.total}`)
    const where = await page.evaluate(() => {
      const d = window.__paibanApi.doc
      return d.pages.flatMap((p, pi) => p.els.filter((e) => e.id === 'p0-3').map((e) => ({ pi, y: e.y })))
    })
    assert(where.length === 1 && where[0].pi === 1 && where[0].y < 170, `p0-3 翻页位置错误：${JSON.stringify(where)}`)
  })

  await test('打印：点按即开预览、弹窗内切彩色/黑白', async () => {
    await resetEditor(page)
    await page.evaluate(() => document.body.classList.remove('ed-bw-preview'))
    await page.locator('[data-el-id="p0-3"]').click()
    await sleep(200)
    // 点打印按钮 → 直接打开预览弹窗（不再先弹「选彩色/黑白」的设置浮层）
    await page.locator('.ed-print-trigger').click()
    await page.waitForFunction(
      () => !!document.querySelector('#ed-print-preview iframe')?.contentDocument?.querySelector('.ed-page-wrap'),
      null,
      { timeout: 15000 },
    )
    assert((await page.locator('.ed-print-pop').count()) === 0, '不应再出现打印设置浮层')

    const readMode = () =>
      page.evaluate(() => {
        const d = document.querySelector('#ed-print-preview iframe').contentDocument
        const p0 = d.querySelector('.ed-page')
        return {
          filter: getComputedStyle(p0).filter,
          colorOn: d.getElementById('pv-mode-color').classList.contains('is-on'),
          bwOn: d.getElementById('pv-mode-bw').classList.contains('is-on'),
          label: d.getElementById('pv-mode-label').textContent,
          sel: window.__paibanApi.selection,
          editorFilter: getComputedStyle(document.querySelector('.ed-page')).filter,
        }
      })
    const clickMode = (id) =>
      page.evaluate((btnId) => document.querySelector('#ed-print-preview iframe').contentDocument.getElementById(btnId).click(), id)

    const initial = await readMode()
    assert(initial.filter === 'none' && initial.colorOn && initial.label === '彩色', `默认应为彩色：${JSON.stringify(initial)}`)

    await clickMode('pv-mode-bw')
    await sleep(150)
    const bw = await readMode()
    assert(bw.filter.includes('grayscale') && bw.bwOn && bw.label === '黑白', `弹窗内黑白没生效：${JSON.stringify(bw)}`)
    assert(bw.sel === 'p0-3', '切换预览配色时选中状态被清除了')
    assert(bw.editorFilter === 'none', `切换预览配色不应把编辑器画布变灰：${bw.editorFilter}`)

    await clickMode('pv-mode-color')
    await sleep(150)
    const color = await readMode()
    assert(color.filter === 'none' && color.colorOn && color.label === '彩色', `切回彩色失败：${JSON.stringify(color)}`)

    await clickMode('print-close')
    await sleep(200)
    assert(await page.evaluate(() => !document.getElementById('ed-print-preview')), '预览弹窗未能关闭')
  })

  await test('打印媒体：纸张尺寸、无空白页', async () => {
    await resetEditor(page)
    await page.locator('[data-el-id="p0-3"]').click()
    await sleep(150)
    const dims = await page.evaluate(() => ({ w: window.__paibanApi.doc.w, h: window.__paibanApi.doc.h, pages: window.__paibanApi.doc.pages.length }))
    await page.emulateMedia({ media: 'print' })
    await sleep(250)
    const print = await page.evaluate(() => {
      const bar = document.querySelector('.ed-toolbar')
      const pageEl = document.querySelector('.ed-page')
      const r = pageEl.getBoundingClientRect()
      const styles = [...document.querySelectorAll('style')].map((s) => s.textContent || '')
      return {
        toolbar: bar ? getComputedStyle(bar).display : 'missing',
        pageW: r.width,
        pageH: r.height,
        hasAtPage: styles.some((s) => s.includes('@page') && s.includes(`${window.__paibanApi.doc.w}px`)),
      }
    })
    assert(print.toolbar === 'none', '打印时工具栏应隐藏')
    assert(Math.abs(print.pageW - dims.w) < 2, `打印页宽应为 ${dims.w}，实际 ${print.pageW}`)
    assert(Math.abs(print.pageH - dims.h) < 2, `打印页高应为 ${dims.h}，实际 ${print.pageH}`)
    assert(print.hasAtPage, '缺少与当前纸张尺寸匹配的 @page 规则')
    const selectedPrint = await page.evaluate(() => ({
      handles: [...document.querySelectorAll('.ed-handle')].filter((n) => getComputedStyle(n).display !== 'none').length,
      outline: getComputedStyle(document.querySelector('.ed-el.is-selected')).outlineStyle,
    }))
    assert(selectedPrint.handles === 0 && selectedPrint.outline === 'none', `打印时仍显示选中框：${JSON.stringify(selectedPrint)}`)
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true })
    const pdfPath = path.join(ARTIFACT_DIR, '05-print.pdf')
    await fs.writeFile(pdfPath, pdf)
    const pdfPages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length
    assert(pdfPages === dims.pages, `打印页数应为 ${dims.pages}，实际 ${pdfPages}（出现空白页）`)
    await screenshot(page, '05-print.png')
    await page.emulateMedia({ media: 'screen' })
    const selectionAfterPrint = await page.evaluate(() => window.__paibanApi.selection)
    assert(selectionAfterPrint === 'p0-3', `打印预览后选中状态丢失：${selectionAfterPrint}`)
  })

  await test('应用内打印预览：A4、黑白切换、无空白页', async () => {
    await resetEditor(page)
    await page.locator('[data-el-id="p0-3"]').click()
    await sleep(200)
    // 一次点击直达预览弹窗
    await page.locator('.ed-print-trigger').click()
    await page.waitForFunction(() => {
      const f = document.querySelector('#ed-print-preview iframe')
      return !!f?.contentDocument?.querySelector('.ed-page-wrap')
    })
    // 黑白在弹窗标题栏切换
    await page.evaluate(() => document.querySelector('#ed-print-preview iframe').contentDocument.getElementById('pv-mode-bw').click())
    await sleep(150)
    const preview = await page.evaluate(() => {
      const f = document.querySelector('#ed-print-preview iframe')
      const d = f.contentDocument
      const pages = [...d.querySelectorAll('.ed-page')]
      return {
        count: pages.length,
        bar: !!d.querySelector('.print-preview-bar'),
        // 弹窗会按整页可见缩放（zoom），所以看布局尺寸而不是 getBoundingClientRect
        w: pages[0]?.offsetWidth,
        h: pages[0]?.offsetHeight,
        filter: getComputedStyle(pages[0]).filter,
        text: d.body.innerText.slice(0, 80),
        sel: window.__paibanApi.selection,
      }
    })
    const expectedPages = await page.evaluate(() => window.__paibanApi.doc.pages.length)
    assert(preview.count === expectedPages, `预览页数错误：${preview.count}/${expectedPages}`)
    assert(preview.bar, '预览缺少打印工具栏')
    assert(Math.abs(preview.w - 1122.52) < 2 && Math.abs(preview.h - 793.7) < 2, `预览纸张尺寸错误：${preview.w}×${preview.h}`)
    assert(preview.filter.includes('grayscale'), `黑白预览没有灰度：${preview.filter}`)
    assert(preview.sel === 'p0-3', '打开打印预览后选中状态丢失')
    await screenshot(page, '05-print-preview.png')
    await page.evaluate(() => {
      const f = document.querySelector('#ed-print-preview iframe')
      f.contentDocument?.getElementById('print-close')?.click()
    })
    await sleep(200)
    assert(await page.evaluate(() => !document.getElementById('ed-print-preview')), '打印预览没有关闭')
  })

  /* ---------------- 自动存档 ---------------- */

  const resetAutosave = async () => {
    await page.evaluate(() => {
      localStorage.removeItem('paiban-editor-doc-v1')
      localStorage.removeItem('paiban-doc-snapshots-v1')
      localStorage.removeItem('paiban-save-meta-v1')
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!window.__paibanApi)
    await waitSettled(page)
  }

  await test('自动存档：改完 0.4 秒落盘，状态显示保存时间', async () => {
    await resetAutosave()
    const target = await page.evaluate(() => {
      const el = window.__paibanApi.doc.pages[0].els.find((e) => e.kind === 'text' && !e.locked)
      return { id: el.id, y: el.y }
    })
    await page.evaluate((id) => window.__paibanApi.nudge(id, 0, 8), target.id)
    const saved = await page.evaluate(async (id) => {
      await new Promise((r) => setTimeout(r, 900))
      const raw = localStorage.getItem('paiban-editor-doc-v1')
      const parsed = raw ? JSON.parse(raw) : null
      const stored = parsed?.pages.flatMap((p) => p.els).find((e) => e.id === id)
      const live = window.__paibanApi.doc.pages.flatMap((p) => p.els).find((e) => e.id === id)
      // 保存状态不挂在 api 上（避免整树重渲染），看落盘的元信息 + 工具栏角标
      const meta = JSON.parse(localStorage.getItem('paiban-save-meta-v1') || 'null')
      return {
        storedY: stored?.y,
        liveY: live?.y,
        at: meta?.at,
        dot: document.querySelector('.ed-save-dot')?.className ?? '',
      }
    }, target.id)
    assert(typeof saved.at === 'number' && Date.now() - saved.at < 60_000, `没有记录保存时间：${saved.at}`)
    assert(!saved.dot.includes('is-err'), `工具栏显示保存失败：${saved.dot}`)
    assert(Math.abs(saved.storedY - saved.liveY) < 0.5, `存档与内存不一致：${saved.storedY} vs ${saved.liveY}`)
    assert(Math.abs(saved.liveY - (target.y + 8)) < 0.5, `微调没有生效：${target.y} → ${saved.liveY}`)
  })

  await test('10 秒快照：打了点、内容没变就不重复写', async () => {
    const before = await page.evaluate(
      () => JSON.parse(localStorage.getItem('paiban-doc-snapshots-v1') || '{"list":[]}').list.length,
    )
    const after = await page.evaluate(() => {
      const api = window.__paibanApi
      api.saveNow()
      api.saveNow()
      api.saveNow()
      // 同一个 tick 里 React state 还没更新，直接读落盘结果更可靠
      return JSON.parse(localStorage.getItem('paiban-doc-snapshots-v1') || '{"list":[]}').list
    })
    assert(after.length === before + 1, `内容没变却重复写快照：${before} → ${after.length}`)
    assert(after[0].pages >= 2 && after[0].els > 20, `快照元信息异常：${JSON.stringify(after[0])}`)
  })

  await test('快照恢复：删掉的组件能退回，恢复本身可撤销', async () => {
    const { victim, snapAt } = await page.evaluate(() => {
      const api = window.__paibanApi
      const el = api.doc.pages[0].els.find((e) => e.kind === 'text' && !e.locked)
      api.saveNow() // 先给「有它」的状态打个点
      const list = JSON.parse(localStorage.getItem('paiban-doc-snapshots-v1') || '{"list":[]}').list
      api.removeEl(el.id)
      return { victim: el.id, snapAt: list[0].at }
    })
    await waitSettled(page)
    const gone = await page.evaluate((id) => !window.__paibanApi.doc.pages.some((p) => p.els.some((e) => e.id === id)), victim)
    assert(gone, '组件没有被删掉，用例前提不成立')

    const restored = await page.evaluate(
      ([id, at]) => {
        const api = window.__paibanApi
        const ok = api.restoreSnapshot(at)
        const back = api.doc.pages.some((p) => p.els.some((e) => e.id === id))
        return { ok, back }
      },
      [victim, snapAt],
    )
    assert(restored.ok, '恢复快照返回失败')
    assert(restored.back, '恢复后组件没有回来')
    await waitSettled(page)
    assertInvariants(await readState(page), '恢复快照后')

    // 恢复走的是 commit，应该能 Ctrl+Z 回到「删掉」的状态
    await page.evaluate(() => window.__paibanApi.undo())
    await waitSettled(page)
    const undone = await page.evaluate((id) => !window.__paibanApi.doc.pages.some((p) => p.els.some((e) => e.id === id)), victim)
    assert(undone, '撤销恢复后没有回到删除状态')
    await page.evaluate(() => window.__paibanApi.redo())
    await waitSettled(page)
    await screenshot(page, '06-autosave.png')
  })

  await test('存档浮层：列出快照、能点开', async () => {
    await page.evaluate(() => window.__paibanApi.saveNow())
    await page.click('.ed-tb-save')
    await page.waitForSelector('.ed-save-pop', { timeout: 3000 })
    const items = await page.locator('.ed-save-pop .ed-save-item').count()
    assert(items >= 1, `浮层里没有快照条目：${items}`)
    const first = await page.locator('.ed-save-pop .ed-save-item').first().innerText()
    assert(/\d{2}:\d{2}:\d{2}/.test(first), `快照条目缺少时间：${first}`)
    await page.keyboard.press('Escape')
    await page.evaluate(() => document.querySelector('.ed-tb-save')?.click())
  })

  await test('存档损坏：先原样备份，再用初始模板起', async () => {
    await page.evaluate(() => {
      localStorage.setItem('paiban-editor-doc-v1', '{"pages":[{"els":[oops')
      localStorage.removeItem('paiban-editor-doc-v1.corrupt')
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!window.__paibanApi)
    await waitSettled(page)
    const result = await page.evaluate(() => ({
      pages: window.__paibanApi.doc.pages.length,
      backup: localStorage.getItem('paiban-editor-doc-v1.corrupt'),
    }))
    assert(result.pages >= 2, `损坏存档没有回退到初始模板：${result.pages} 页`)
    assert(result.backup && result.backup.includes('oops'), '损坏存档没有被备份，后续自动保存会把它盖掉')
    await resetAutosave()
  })

  const fatal = logs.filter((l) => l.type === 'pageerror')
  await test('运行期无 pageerror', async () => {
    assert(fatal.length === 0, `出现 ${fatal.length} 个页面异常：\n${fatal.map((l) => l.text).join('\n').slice(0, 1200)}`)
  })

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${failed.length ? '✗' : '✓'} 冒烟结果：${results.length - failed.length}/${results.length} 通过，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log(`截图目录：${path.relative(process.cwd(), ARTIFACT_DIR)}`)
  if (failed.length) process.exitCode = 1
} catch (err) {
  try {
    await screenshot(page, '99-failure.png')
  } catch {
    /* 忽略 */
  }
  console.error(`\n✗ 冒烟中断：${err.stack || err.message}`)
  console.error(`截图目录：${path.relative(process.cwd(), ARTIFACT_DIR)}`)
  process.exitCode = 1
} finally {
  await closeBrowser()
  if (server.proc) {
    try {
      server.proc.kill('SIGTERM')
    } catch {
      /* 忽略 */
    }
  }
}
