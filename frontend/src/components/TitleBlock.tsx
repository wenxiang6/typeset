/** 第 1 页顶部标题区：红色主标题 + 姓名/学号框 + 双线装饰 */
export function TitleBlock() {
  return (
    <>
      <div className="main-title">地理时政周刊一</div>
      <div className="name-box">
        <div className="name-line">
          姓名:<i className="fill" />
        </div>
        <div className="name-line">
          学号:<i className="fill" />
        </div>
      </div>
      <div className="double-rule" />
    </>
  )
}
