/**
 * 属性面板的表单原语。
 *
 * 以前 Inspector 里同一个东西要写四五遍：
 *   <label className="ed-field"><span>字体</span><select>…map…</select></label>
 * 一个下拉框 8 行，10 个下拉框就是 80 行重复代码，改标签样式要改 10 处。
 * 现在统一收在这里，Inspector 里只剩「label + value + options + onChange」四个参数。
 *
 * 新增字段优先用这些，别再手写 label/select。
 */
import type { ReactNode } from 'react'

export type Option = { value: string | number; label: string }

/** 一行字段：上面标签、下面控件 */
export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode
  /** 标签右边的浅色补充说明 */
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="ed-field">
      <span>
        {label}
        {hint ? <i className="ed-field-hint">{hint}</i> : null}
      </span>
      {children}
    </label>
  )
}

/** 下拉字段；placeholder 传 null 表示不加「默认」那一项 */
export function SelectField({
  label,
  hint,
  value,
  options,
  onChange,
  placeholder = '默认',
  compact,
}: {
  label: ReactNode
  hint?: ReactNode
  value: string | number
  options: Option[]
  onChange: (v: string) => void
  placeholder?: string | null
  /** 紧凑模式：标签在上、下拉占满一格，用于多列并排 */
  compact?: boolean
}) {
  const select = (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )

  if (compact) {
    return (
      <div className="ed-fg-cell">
        <span className="ed-fg-label">{label}</span>
        {select}
      </div>
    )
  }

  return (
    <Field label={label} hint={hint}>
      {select}
    </Field>
  )
}

/**
 * 一格多列的横排：字体 / 字号 / 字色 / 底色 这种最常用的四项并排一行，
 * 省下来的纵向空间留给真正需要整行的内容。
 */
export function FieldGrid({ children, cols = 4 }: { children: ReactNode; cols?: number }) {
  return (
    <div className="ed-fg" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {children}
    </div>
  )
}

/** 数字字段（X/Y/宽/高/旋转…） */
export function NumField({
  label,
  value,
  onChange,
  step = 1,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  disabled?: boolean
}) {
  return (
    <label className="ed-num">
      <span>{label}</span>
      <input
        type="number"
        value={Math.round(value * 10) / 10}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </label>
  )
}

/** 一行「标签 + 控件」，用于对齐、线宽、层级这类横排 */
export function Row({
  label,
  children,
  className,
}: {
  label?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className ? `ed-insp-row ${className}` : 'ed-insp-row'}>
      {label !== undefined ? <span>{label}</span> : null}
      {children}
    </div>
  )
}

/** 一排互斥按钮（对齐方式、线宽、字重…） */
export function ChoiceRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
  suffix,
}: {
  label?: ReactNode
  value: T | undefined
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  suffix?: string
}) {
  return (
    <Row label={label}>
      {options.map((o) => (
        <button key={String(o.value)} className={value === o.value ? 'is-on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
      {suffix ? <span className="ed-hint">{suffix}</span> : null}
    </Row>
  )
}

/** 说明文字 */
export function Note({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="ed-insp-note" style={style}>
      {children}
    </div>
  )
}
