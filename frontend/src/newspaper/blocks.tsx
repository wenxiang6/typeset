import type { ReactNode } from 'react'
import { IMAGES } from '../config/images'
import { SlotImage } from '../components/Runs'

export function Section({ num, title, children }: { num: string; title: string; children: ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">
        <span className="num">{num}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="label">{children}</span>
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="note">{children}</div>
}

export function ConceptBox({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="concept-box">
      <span className="name">{name}</span>
      {children}
    </div>
  )
}

export function Chain({ children }: { children: ReactNode }) {
  return <div className="chain">{children}</div>
}

export function Arrow() {
  return <span className="arrow">→</span>
}

export function Trap({ children }: { children: ReactNode }) {
  return (
    <div className="trap">
      <span className="x">✕</span>
      <span className="t">{children}</span>
    </div>
  )
}

export function Tpl({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="tpl">
      <h4>{title}</h4>
      {children}
    </div>
  )
}

export function Quiz({ children }: { children: ReactNode }) {
  return <div className="quiz">{children}</div>
}

export function Ans({ children }: { children: ReactNode }) {
  return <span className="ans">{children}</span>
}

export function Exp({ children }: { children: ReactNode }) {
  return <span className="exp">{children}</span>
}

export function Req({ children }: { children: ReactNode }) {
  return <div className="req">{children}</div>
}

export function NameRow() {
  return (
    <div className="name-row">
      <span>姓名：</span>
      <span>学号：</span>
    </div>
  )
}

/** 沃克环流示意图（图片位，换图改 src/config/images.ts） */
export function Shilitu() {
  return (
    <div className="img-ph">
      <SlotImage
        src={IMAGES.shilitu}
        alt="图 · 沃克环流示意图"
        className="shilitu"
        placeholderClass="shilitu shilitu-ph"
        label="图 · 沃克环流示意图（待替换）"
      />
    </div>
  )
}
