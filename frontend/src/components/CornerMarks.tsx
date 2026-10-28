/** 页面四角外向裁切角标 + 左上角点阵装饰（与参考图一致） */
export function CornerMarks() {
  return (
    <>
      <div className="corner tl">
        <i className="v" />
        <i className="h" />
      </div>
      <div className="corner tr">
        <i className="v" />
        <i className="h" />
      </div>
      <div className="corner bl">
        <i className="v" />
        <i className="h" />
      </div>
      <div className="corner br">
        <i className="v" />
        <i className="h" />
      </div>
      <div className="dots">
        {[0, 1].map((c) =>
          [0, 1, 2].map((r) => (
            <i
              key={`${c}-${r}`}
              style={{ left: c * 10, top: r * 11 }}
            />
          )),
        )}
      </div>
    </>
  )
}
