/**
 * 线性图标集（WPS 风格，18px，stroke=currentColor）—— 零依赖内联 SVG
 */
import type { ReactNode } from 'react'

type P = { size?: number; className?: string }

function S({ size = 18, className, children }: P & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/* —— 通用操作 —— */
export const IconUndo = (p: P) => (
  <S {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h9a6 6 0 1 1 0 12h-3" />
  </S>
)
export const IconRedo = (p: P) => (
  <S {...p}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9h-9a6 6 0 1 0 0 12h3" />
  </S>
)
export const IconCopy = (p: P) => (
  <S {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </S>
)
export const IconTrash = (p: P) => (
  <S {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 10v7M14 10v7" />
  </S>
)
export const IconLock = (p: P) => (
  <S {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </S>
)
export const IconUnlock = (p: P) => (
  <S {...p}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 7.5-2" />
  </S>
)
export const IconGrid = (p: P) => (
  <S {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </S>
)
export const IconMagnet = (p: P) => (
  <S {...p}>
    <path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z" />
    <path d="M6 8h4M14 8h4" />
  </S>
)
export const IconRegion = (p: P) => (
  <S {...p}>
    <rect x="3" y="5" width="18" height="14" strokeDasharray="4 3" />
  </S>
)
export const IconDownload = (p: P) => (
  <S {...p}>
    <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
  </S>
)
export const IconUpload = (p: P) => (
  <S {...p}>
    <path d="M12 15V3M7 8l5-5 5 5M4 21h16" />
  </S>
)
export const IconPrint = (p: P) => (
  <S {...p}>
    <path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z" />
  </S>
)
export const IconReset = (p: P) => (
  <S {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </S>
)
export const IconEye = (p: P) => (
  <S {...p}>
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </S>
)
export const IconZoomIn = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3M8 11h6M11 8v6" />
  </S>
)
export const IconZoomOut = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3M8 11h6" />
  </S>
)

/* —— 格式 —— */
export const IconTextColor = (p: P) => (
  <S {...p}>
    <path d="M6 16 12 4l6 12M8.2 12h7.6" />
    <path d="M5 21h14" strokeWidth="3" />
  </S>
)
export const IconHighlight = (p: P) => (
  <S {...p}>
    <path d="M13 4l7 7-7 7-7-7z" />
    <path d="M8 20h12M4 16l3 3" />
  </S>
)
export const IconAlignLeft = (p: P) => <S {...p}><path d="M4 6h16M4 12h10M4 18h13" /></S>
export const IconAlignCenter = (p: P) => <S {...p}><path d="M4 6h16M7 12h10M6 18h12" /></S>
export const IconAlignRight = (p: P) => <S {...p}><path d="M4 6h16M10 12h10M7 18h13" /></S>
export const IconAlignJustify = (p: P) => <S {...p}><path d="M4 6h16M4 12h16M4 18h16" /></S>
export const IconListOl = (p: P) => (
  <S {...p}>
    <path d="M9 6h12M9 12h12M9 18h12" />
    <path d="M3.5 4.8 5 4v4M3 12.2c.3-.5.9-.7 1.5-.7.8 0 1.4.4 1.4 1.1 0 .5-.3.8-.9 1.3l-1.6 1.4h3" />
  </S>
)
export const IconListUl = (p: P) => (
  <S {...p}>
    <path d="M9 6h12M9 12h12M9 18h12" />
    <circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none" />
  </S>
)
export const IconEraser = (p: P) => (
  <S {...p}>
    <path d="M9 20h11M4 15l7-7 6 6-6 6H6z" />
    <path d="M10 8l6 6" />
  </S>
)

/* —— 组件（插入） —— */
export const IconTitle = (p: P) => <S {...p}><path d="M5 5h14M12 5v14M9 19h6" /></S>
export const IconHeading = (p: P) => <S {...p}><path d="M6 5v14M18 5v14M6 12h12" /></S>
export const IconSubhead = (p: P) => <S {...p}><path d="M6 5v14M18 5v10M6 12h12" /></S>
export const IconParagraph = (p: P) => (
  <S {...p}>
    <path d="M9 4h4a4 4 0 0 1 0 8H9zM9 12v8M13 12v8" />
  </S>
)
export const IconTag = (p: P) => (
  <S {...p}>
    <path d="M4 4h8l8 8-8 8-8-8z" />
    <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
  </S>
)
export const IconListCheck = (p: P) => (
  <S {...p}>
    <path d="M3 6l2 2 3.5-3.5M3 13l2 2 3.5-3.5M3 20l2 2 3.5-3.5" />
    <path d="M12 6h9M12 13h9M12 20h9" />
  </S>
)
export const IconInfoBox = (p: P) => (
  <S {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 10v6M12 8h.01" />
  </S>
)
export const IconBookmark = (p: P) => (
  <S {...p}>
    <path d="M6 3h12v18l-6-4.5L6 21z" />
    <path d="M9 8h6" />
  </S>
)
export const IconFlow = (p: P) => (
  <S {...p}>
    <path d="M3 8h8l2 4h6" />
    <path d="M16 9l3 3-3 3" />
    <path d="M3 17h5" />
  </S>
)
export const IconWarning = (p: P) => (
  <S {...p}>
    <path d="M12 3l9 17H3z" />
    <path d="M12 9v5M12 17h.01" />
  </S>
)
export const IconClipboard = (p: P) => (
  <S {...p}>
    <path d="M9 4H6v17h12V4h-3M9 3h6v3H9z" />
    <path d="M9 12h6M9 16h6" />
  </S>
)
export const IconQuiz = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9.2a2.8 2.8 0 1 1 4 2.5V14M12 17h.01" />
  </S>
)
export const IconIdCard = (p: P) => (
  <S {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.5" cy="11" r="2" />
    <path d="M14 10h5M14 14h5M5.5 16c.7-1.2 1.8-1.8 3-1.8s2.3.6 3 1.8" />
  </S>
)
export const IconImage = (p: P) => (
  <S {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 17l5-5 4 4 3-2 4 3" />
  </S>
)
export const IconMinus = (p: P) => <S {...p}><path d="M4 12h16" /></S>

/* —— 扩展组件图标 —— */
export const IconChart = (p: P) => (
  <S {...p}>
    <path d="M4 20V4M4 20h16" />
    <rect x="7" y="12" width="3" height="5" />
    <rect x="12" y="8" width="3" height="9" />
    <rect x="17" y="5" width="3" height="12" />
  </S>
)
export const IconCompare = (p: P) => (
  <S {...p}>
    <rect x="3" y="5" width="8" height="14" rx="1" />
    <rect x="13" y="5" width="8" height="14" rx="1" />
    <path d="M6 9h2M6 12h2M16 9h2M16 12h2" />
  </S>
)
export const IconTimeline = (p: P) => (
  <S {...p}>
    <path d="M7 4v16" />
    <circle cx="7" cy="7" r="2" />
    <circle cx="7" cy="12" r="2" />
    <circle cx="7" cy="17" r="2" />
    <path d="M11 7h9M11 12h9M11 17h9" />
  </S>
)
export const IconTable = (p: P) => (
  <S {...p}>
    <rect x="3" y="4" width="18" height="16" rx="1" />
    <path d="M3 9h18M3 14h18M9 4v16M15 4v16" />
  </S>
)
export const IconFormula = (p: P) => (
  <S {...p}>
    <path d="M6 19l4-14M4 9h6M14 13c0-2 4-2 4 0s-4 0-4 5M14 18h4" />
  </S>
)
export const IconQr = (p: P) => (
  <S {...p}>
    <rect x="3" y="3" width="6" height="6" />
    <rect x="15" y="3" width="6" height="6" />
    <rect x="3" y="15" width="6" height="6" />
    <path d="M15 15h2v2h-2zM19 15h2v2h-2zM15 19h2v2h-2zM19 19h2v2h-2z" />
  </S>
)
export const IconSticky = (p: P) => (
  <S {...p}>
    <path d="M4 4h16v10l-6 6H4z" />
    <path d="M20 14h-6v6" />
    <path d="M7 8h10M7 11h7" />
  </S>
)
