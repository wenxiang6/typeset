export interface ChainModel {
  nodes: string[]
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function parseChain(html?: string): ChainModel | null {
  if (!html) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.querySelector('.chain')
  if (!root) return null
  const raw = (root.textContent || '').replace(/\s+/g, ' ').trim()
  const nodes = raw.split('→').map((s) => s.trim())
  return { nodes: nodes.length ? nodes : [''] }
}

export function buildChain(model: ChainModel): string {
  const nodes = model.nodes.length ? model.nodes : ['']
  const inner = nodes
    .map((n, i) => `${i ? '<span class="arrow">→</span>' : ''}<span class="node">${esc(n)}</span>`)
    .join('')
  return `<div class="chain">${inner}</div>`
}
