import type { Doc } from './types'

/** 默认模板：首次打开编辑器、自动高度/分页稳定后的现有版面快照 */
export const DEFAULT_LAYOUT: Doc = {
  "version": 3,
  "w": 1122.52,
  "h": 793.7,
  "orientation": "landscape",
  "margin": {
    "top": 37.8,
    "right": 45.3,
    "bottom": 60.5,
    "left": 45.3
  },
  "flow": {
    "autoHeight": true,
    "autoPage": true
  },
  "watermark": {
    "text": "地理时政周刊 · 曹明环 · 何文静",
    "size": 14,
    "opacity": 0.15,
    "angle": -30
  },
  "defaults": {
    "fontFamily": "\"Lantinghei SC\",\"PingFang SC\",\"Heiti SC\",\"SimHei\",\"Microsoft YaHei\",sans-serif",
    "fontSize": "14px"
  },
  "pages": [
    {
      "id": "page-0",
      "els": [
        {
          "id": "p0-0",
          "kind": "chrome",
          "variant": "header",
          "html": "<div class=\"header\"><div class=\"header-left\"><div class=\"header-title\">地理时政周刊 <span>GEO WEEKLY</span></div></div><div class=\"header-right\"><div class=\"issue\">第一期</div><div>2026.10.25</div></div></div>",
          "x": 45.3,
          "y": 37.8,
          "w": 1031.8,
          "h": 38,
          "z": 24
        },
        {
          "id": "p0-1",
          "kind": "chrome",
          "variant": "masthead",
          "html": "<div class=\"masthead\"><div class=\"kicker\">期刊一</div><h1>超强厄尔尼诺已经形成</h1><div class=\"sub\">海 — 气 相 互 作 用 &nbsp;·&nbsp; 全 球 气 候 异 常 &nbsp;·&nbsp; 高 考 必 考</div></div>",
          "x": 45.3,
          "y": 80.5,
          "w": 1031.8,
          "h": 104,
          "z": 32
        },
        {
          "id": "p0-2",
          "kind": "chrome",
          "variant": "section-title",
          "html": "<div class=\"section-title\"><span class=\"num\">一</span><h2>教材定位（湘教版高考溯源）</h2></div>",
          "x": 45.3,
          "y": 195.8,
          "w": 508.9,
          "h": 24,
          "z": 40
        },
        {
          "id": "p0-3",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p><span class=\"label\">对接教材：</span>湘教版选择性必修1 第四章第三节《海—气相互作用》</p>",
          "x": 45.3,
          "y": 223.8,
          "w": 508.9,
          "h": 22,
          "z": 48
        },
        {
          "id": "p0-4",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p><span class=\"label\">内容：</span>教材本源 + 高考考纲 + 必背知识点 + 独立答题模板 + 高考配套习题</p>",
          "x": 45.3,
          "y": 249.8,
          "w": 508.9,
          "h": 22,
          "z": 56
        },
        {
          "id": "p0-5",
          "kind": "box",
          "variant": "note",
          "html": "<div class=\"note\"><strong>本节核心考点：</strong>海—气相互作用与全球气候异常。海洋与大气之间持续进行热量、水汽、能量交换；赤道太平洋海温异常波动，会改变沃克环流，引发全球大气环流紊乱，产生连锁式气候、水文、生态灾害。</div>",
          "x": 45.3,
          "y": 275.8,
          "w": 508.9,
          "h": 70,
          "z": 64
        },
        {
          "id": "p0-6",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>教材核心定义</h3>",
          "x": 45.3,
          "y": 349.8,
          "w": 508.9,
          "h": 21,
          "z": 72
        },
        {
          "id": "p0-7",
          "kind": "box",
          "variant": "concept",
          "html": "<div class=\"concept-box\"><span class=\"name\">厄尔尼诺：</span>赤道中东太平洋表层海水异常升温，周期 2—7 年。根源为东南信风减弱。</div>",
          "x": 45.3,
          "y": 374.8,
          "w": 508.9,
          "h": 26,
          "z": 80
        },
        {
          "id": "p0-8",
          "kind": "box",
          "variant": "concept",
          "html": "<div class=\"concept-box\"><span class=\"name\">拉尼娜：</span>赤道中东太平洋表层海水异常降温，为反向海气异常现象。</div>",
          "x": 45.3,
          "y": 404.8,
          "w": 508.9,
          "h": 26,
          "z": 88
        },
        {
          "id": "p0-9",
          "kind": "box",
          "variant": "concept",
          "html": "<div class=\"concept-box\"><span class=\"name\">正常沃克环流：</span>西太平洋暖、上升气流、多雨；东太平洋冷、下沉气流、少雨干旱。</div>",
          "x": 45.3,
          "y": 434.8,
          "w": 508.9,
          "h": 26,
          "z": 96
        },
        {
          "id": "p0-10",
          "kind": "chrome",
          "variant": "section-title",
          "html": "<div class=\"section-title\"><span class=\"num\">二</span><h2>高考考纲 &amp; 命题能力要求</h2></div>",
          "x": 45.3,
          "y": 464.8,
          "w": 508.9,
          "h": 24,
          "z": 104
        },
        {
          "id": "p0-11",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p><span class=\"label\">核心素养：</span>综合思维（海气耦合机制）、区域认知（全球气候联动差异）</p>",
          "x": 45.3,
          "y": 492.8,
          "w": 508.9,
          "h": 22,
          "z": 112
        },
        {
          "id": "p0-12",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>必考能力</h3>",
          "x": 45.3,
          "y": 518.8,
          "w": 508.9,
          "h": 21,
          "z": 120
        },
        {
          "id": "p0-13",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p>① 判读海温距平图、沃克环流示意图</p>",
          "x": 45.3,
          "y": 543.8,
          "w": 508.9,
          "h": 22,
          "z": 128
        },
        {
          "id": "p0-14",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p>② 完整推导厄尔尼诺、拉尼娜成因逻辑链</p>",
          "x": 45.3,
          "y": 569.8,
          "w": 508.9,
          "h": 22,
          "z": 136
        },
        {
          "id": "p0-15",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p>③ 精准推演太平洋两岸、我国气候、渔场、台风变化</p>",
          "x": 45.3,
          "y": 595.8,
          "w": 508.9,
          "h": 22,
          "z": 144
        },
        {
          "id": "p0-16",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p>④ 区分两类海气异常的不同影响，杜绝混淆</p>",
          "x": 45.3,
          "y": 621.8,
          "w": 508.9,
          "h": 22,
          "z": 152
        },
        {
          "id": "p0-17",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>高考命题趋势</h3>",
          "x": 45.3,
          "y": 647.8,
          "w": 508.9,
          "h": 21,
          "z": 160
        },
        {
          "id": "p0-18",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p>以年度极端天气、全球气候异常时政切入，重因果、重逻辑、重整体性，极少纯概念默写。</p>",
          "x": 45.3,
          "y": 672.8,
          "w": 508.9,
          "h": 43,
          "z": 168
        },
        {
          "id": "p0-25",
          "kind": "chrome",
          "variant": "section-title",
          "html": "<div class=\"section-title\"><span class=\"num\">三</span><h2>厄尔尼诺 · 必背主干知识</h2></div>",
          "x": 568.3,
          "y": 195.8,
          "w": 508.9,
          "h": 24,
          "z": 224
        },
        {
          "id": "p0-26",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>1. 定义与判定</h3>",
          "x": 568.3,
          "y": 223.8,
          "w": 508.9,
          "h": 21,
          "z": 232
        },
        {
          "id": "p0-27",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p>赤道中东太平洋海区，表层海水持续异常增温。</p>",
          "x": 568.3,
          "y": 248.8,
          "w": 508.9,
          "h": 22,
          "z": 240
        },
        {
          "id": "p0-28",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p><span class=\"label\">判定标准：</span>海温距平 ≥ +0.5℃，连续多月持续，即为厄尔尼诺事件。周期 2—7 年。</p>",
          "x": 568.3,
          "y": 274.8,
          "w": 508.9,
          "h": 43,
          "z": 248
        },
        {
          "id": "p0-29",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>2. 形成机理（必背逻辑链）</h3>",
          "x": 568.3,
          "y": 321.8,
          "w": 508.9,
          "h": 21,
          "z": 256
        },
        {
          "id": "p0-30",
          "kind": "box",
          "variant": "chain",
          "html": "<div class=\"chain\">东南信风减弱<span class=\"arrow\">→</span>南赤道暖流减弱、赤道逆流增强<span class=\"arrow\">→</span>西太平洋暖水向东堆积<span class=\"arrow\">→</span>中东太平洋暖水增多<span class=\"arrow\">→</span>沿岸上升补偿流减弱、冷水上泛减少<span class=\"arrow\">→</span>海温异常升高<span class=\"arrow\">→</span>太平洋东西温差减小<span class=\"arrow\">→</span>沃克环流减弱甚至反转</div>",
          "x": 568.3,
          "y": 346.8,
          "w": 508.9,
          "h": 78,
          "z": 264
        },
        {
          "id": "p0-31",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>3. 全球气候与生态影响</h3>",
          "x": 568.3,
          "y": 428.8,
          "w": 508.9,
          "h": 21,
          "z": 272
        },
        {
          "id": "p0-32",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p><span class=\"label\">太平洋东岸（秘鲁、厄瓜多尔）：</span>海温升高，气流上升，降水激增，暴雨、洪涝多发；上升流大幅减弱，营养盐匮乏，秘鲁渔场严重减产。</p>",
          "x": 568.3,
          "y": 453.8,
          "w": 508.9,
          "h": 43,
          "z": 280
        },
        {
          "id": "p0-33",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p><span class=\"label\">太平洋西岸（印尼、澳大利亚、东南亚）：</span>海温相对降低，上升气流减弱，盛行下沉气流，持续干旱、森林火灾频发。</p>",
          "x": 568.3,
          "y": 500.8,
          "w": 508.9,
          "h": 43,
          "z": 288
        },
        {
          "id": "p0-34",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>4. 对我国气候高考高频影响</h3>",
          "x": 568.3,
          "y": 547.8,
          "w": 508.9,
          "h": 21,
          "z": 296
        },
        {
          "id": "p0-35",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p>当年冬季：冬季风偏弱，全国易出现暖冬。</p>",
          "x": 568.3,
          "y": 572.8,
          "w": 508.9,
          "h": 22,
          "z": 304
        },
        {
          "id": "p0-36",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p>次年夏季：西太平洋副高偏强、偏南；夏季风偏弱；雨带长期滞留南方 → 南涝北旱；西北太平洋海温偏低 → 台风生成数量偏少。</p>",
          "x": 568.3,
          "y": 598.8,
          "w": 508.9,
          "h": 43,
          "z": 312
        },
        {
          "id": "p0-37",
          "kind": "chrome",
          "variant": "section-title",
          "html": "<div class=\"section-title\"><span class=\"num\">四</span><h2>拉尼娜 · 必背主干知识</h2></div>",
          "x": 568.3,
          "y": 645.8,
          "w": 508.9,
          "h": 24,
          "z": 320
        },
        {
          "id": "p0-38",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>1. 定义与判定</h3>",
          "x": 568.3,
          "y": 673.8,
          "w": 508.9,
          "h": 21,
          "z": 328
        },
        {
          "id": "p0-39",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p>赤道中东太平洋海区，表层海水持续异常降温。</p>",
          "x": 568.3,
          "y": 698.8,
          "w": 508.9,
          "h": 22,
          "z": 336
        },
        {
          "id": "p0-49",
          "kind": "chrome",
          "variant": "footer",
          "html": "<div class=\"footer\"><div class=\"footer-top\"><span>尺幅千里，卷纳乾坤</span><span class=\"center\">— 1 / 3 —</span><span>思接寰宇，笔绘山河</span></div><div class=\"footer-bottom\"><span>地理限时训练</span><span>使用日期：2026年10月26日</span><span>编辑：曹明环</span><span>核对：何文静</span></div></div>",
          "x": 45.3,
          "y": 733.2,
          "w": 1031.8,
          "h": 31,
          "z": 416
        }
      ]
    },
    {
      "id": "page-1",
      "els": [
        {
          "id": "p1-0",
          "kind": "chrome",
          "variant": "header",
          "html": "<div class=\"header\"><div class=\"header-left\"><div class=\"header-title\">地理时政周刊 <span>GEO WEEKLY</span></div></div><div class=\"header-right\"><div class=\"issue\">第一期</div><div>2026.10.25</div></div></div>",
          "x": 45.3,
          "y": 37.8,
          "w": 1031.8,
          "h": 38,
          "z": 429
        },
        {
          "id": "p1-1",
          "kind": "chrome",
          "variant": "section-title",
          "html": "<div class=\"section-title\"><span class=\"num\">六</span><h2>高考标准答题模板（完全分开、独立背诵）</h2></div>",
          "x": 45.3,
          "y": 656.3,
          "w": 508.9,
          "h": 24,
          "z": 437
        },
        {
          "id": "p1-17",
          "kind": "chrome",
          "variant": "footer",
          "html": "<div class=\"footer\"><div class=\"footer-top\"><span>尺幅千里，卷纳乾坤</span><span class=\"center\">— 2 / 3 —</span><span>思接寰宇，笔绘山河</span></div><div class=\"footer-bottom\"><span>地理限时训练</span><span>使用日期：2026年10月26日</span><span>编辑：曹明环</span><span>核对：何文静</span></div></div>",
          "x": 45.3,
          "y": 733.2,
          "w": 1031.8,
          "h": 31,
          "z": 565
        },
        {
          "id": "p0-40",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p><span class=\"label\">判定标准：</span>海温距平 ≤ −0.5℃，持续数月，常尾随厄尔尼诺出现。</p>",
          "x": 45.3,
          "y": 306.3,
          "w": 508.9,
          "h": 22,
          "z": 344
        },
        {
          "id": "p0-41",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>2. 形成机理（必背逻辑链）</h3>",
          "x": 45.3,
          "y": 332.3,
          "w": 508.9,
          "h": 21,
          "z": 352
        },
        {
          "id": "p0-42",
          "kind": "box",
          "variant": "chain",
          "html": "<div class=\"chain\">东南信风异常增强<span class=\"arrow\">→</span>南赤道暖流增强<span class=\"arrow\">→</span>暖海水大量向西太平洋输送<span class=\"arrow\">→</span>中东太平洋暖水流失<span class=\"arrow\">→</span>沿岸上升补偿流大幅增强、底层冷水大量上泛<span class=\"arrow\">→</span>海温异常偏低<span class=\"arrow\">→</span>太平洋东西温差加大<span class=\"arrow\">→</span>沃克环流显著增强</div>",
          "x": 45.3,
          "y": 357.3,
          "w": 508.9,
          "h": 78,
          "z": 360
        },
        {
          "id": "p0-43",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>3. 全球气候与生态影响</h3>",
          "x": 45.3,
          "y": 439.3,
          "w": 508.9,
          "h": 21,
          "z": 368
        },
        {
          "id": "p0-44",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p><span class=\"label\">太平洋东岸（秘鲁沿岸）：</span>海温偏低，下沉气流增强，气候异常干旱；上升流强盛，营养盐丰富，秘鲁渔场增产。</p>",
          "x": 45.3,
          "y": 464.3,
          "w": 508.9,
          "h": 43,
          "z": 376
        },
        {
          "id": "p0-45",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p><span class=\"label\">太平洋西岸（澳洲、印尼、东南亚）：</span>海温偏高，对流旺盛，降水偏多、洪涝灾害多发。</p>",
          "x": 45.3,
          "y": 511.3,
          "w": 508.9,
          "h": 43,
          "z": 384
        },
        {
          "id": "p0-46",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>4. 对我国气候高考高频影响</h3>",
          "x": 45.3,
          "y": 558.3,
          "w": 508.9,
          "h": 21,
          "z": 392
        },
        {
          "id": "p0-47",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p>当年冬季：冬季风强劲、寒潮频发，易出现冷冬。</p>",
          "x": 45.3,
          "y": 583.3,
          "w": 508.9,
          "h": 22,
          "z": 400
        },
        {
          "id": "p0-48",
          "kind": "text",
          "variant": "paragraph",
          "html": "<p>次年夏季：副高偏北、夏季风偏强，雨带北移迅速 → 南旱北涝；西北太平洋海温偏高，热力条件充足 → 台风数量偏多、登陆偏多。</p>",
          "x": 45.3,
          "y": 609.3,
          "w": 508.9,
          "h": 43,
          "z": 408
        },
        {
          "id": "p0-19",
          "kind": "chrome",
          "variant": "section-title",
          "html": "<div class=\"section-title\"><span class=\"num\">五</span><h2>高考重难点 + 高频易错坑</h2></div>",
          "x": 45.3,
          "y": 83.8,
          "w": 508.9,
          "h": 24,
          "z": 176
        },
        {
          "id": "p0-20",
          "kind": "box",
          "variant": "trap",
          "html": "<div class=\"trap\"><span class=\"x\">✕</span><span class=\"t\">厄尔尼诺仅中东太平洋升温，西太平洋降温，并非全球变暖。</span></div>",
          "x": 45.3,
          "y": 111.8,
          "w": 508.9,
          "h": 20,
          "z": 184
        },
        {
          "id": "p0-21",
          "kind": "box",
          "variant": "trap",
          "html": "<div class=\"trap\"><span class=\"x\">✕</span><span class=\"t\">气候异常均为概率趋势，答题必须用\"易出现、大概率\"，不可写绝对化表述。</span></div>",
          "x": 45.3,
          "y": 135.8,
          "w": 508.9,
          "h": 20,
          "z": 192
        },
        {
          "id": "p0-22",
          "kind": "box",
          "variant": "trap",
          "html": "<div class=\"trap\"><span class=\"x\">✕</span><span class=\"t\">渔场变化核心原因是营养盐变化，不是单纯水温高低。</span></div>",
          "x": 45.3,
          "y": 159.8,
          "w": 508.9,
          "h": 20,
          "z": 200
        },
        {
          "id": "p0-23",
          "kind": "box",
          "variant": "trap",
          "html": "<div class=\"trap\"><span class=\"x\">✕</span><span class=\"t\">我国旱涝灾害多出现于事件次年夏季，切忌时间错位。</span></div>",
          "x": 45.3,
          "y": 183.8,
          "w": 508.9,
          "h": 20,
          "z": 208
        },
        {
          "id": "p0-24",
          "kind": "image",
          "variant": "image",
          "src": "/images/img1.png",
          "x": 177.60500000000002,
          "y": 207.8,
          "w": 244.3,
          "h": 94.5,
          "z": 216
        },
        {
          "id": "p1-2",
          "kind": "box",
          "variant": "tpl",
          "html": "<div class=\"tpl\"><h4>【厄尔尼诺专属答题模板】</h4><p><span class=\"label\">成因模板：</span>东南信风减弱，西太平洋暖海水向东输送，赤道中东太平洋海水异常增温；沿岸上升补偿流减弱，沃克环流减弱甚至反转，形成厄尔尼诺现象。</p><p><span class=\"label\">秘鲁渔场减产模板：</span>厄尔尼诺发生，东南信风减弱，秘鲁沿岸上升补偿流减弱，海底营养盐上泛减少，浮游生物不足，鱼类饵料匮乏；海水升温，不适宜冷水鱼类生存，渔业大幅减产。</p><p><span class=\"label\">对我国气候影响模板：</span>厄尔尼诺年份，我国冬季风偏弱，易出现暖冬；次年夏季西太平洋副高偏南偏弱，夏季风势力弱，雨带滞留南方，形成南涝北旱；西北太平洋海温偏低，台风生成数量偏少。</p></div>",
          "x": 568.3100000000001,
          "y": 83.8,
          "w": 508.9,
          "h": 206,
          "z": 445
        },
        {
          "id": "p1-3",
          "kind": "box",
          "variant": "tpl",
          "html": "<div class=\"tpl\"><h4>【拉尼娜专属答题模板】</h4><p><span class=\"label\">成因模板：</span>东南信风异常增强，暖海水向西输送，赤道中东太平洋暖水流失，上升补偿流增强、冷水大量上泛，海温异常偏低，沃克环流显著增强，形成拉尼娜现象。</p><p><span class=\"label\">秘鲁渔场增产模板：</span>拉尼娜发生，东南信风增强，秘鲁沿岸上升补偿流增强，海底营养盐大量上泛，浮游生物繁盛，鱼类饵料充足，利于冷水鱼生存，渔业增产。</p><p><span class=\"label\">对我国气候影响模板：</span>拉尼娜年份，冬季风偏强，寒潮多发，我国易出现冷冬；次年夏季副高偏北、夏季风偏强，雨带北移快，我国易出现南旱北涝；西北太平洋海温偏高，台风多发。</p></div>",
          "x": 568.3100000000001,
          "y": 293.8,
          "w": 508.9,
          "h": 186,
          "z": 453
        },
        {
          "id": "p1-4",
          "kind": "chrome",
          "variant": "section-title",
          "html": "<div class=\"section-title\"><span class=\"num\">七</span><h2>时政高考衔接（周刊总结升华）</h2></div>",
          "x": 568.3100000000001,
          "y": 483.8,
          "w": 508.9,
          "h": 24,
          "z": 461
        },
        {
          "id": "p1-5",
          "kind": "box",
          "variant": "note",
          "html": "<div class=\"note\">厄尔尼诺、拉尼娜是海—气相互作用、地理整体性最核心的时政载体。局部海域海温微小异常，通过大气环流遥相关，引发全球各大洲旱涝、冷暖、渔业、台风连锁变化，是新高考综合思维必考热点。</div>",
          "x": 568.3100000000001,
          "y": 511.8,
          "w": 508.9,
          "h": 70,
          "z": 469
        },
        {
          "id": "p1-6",
          "kind": "chrome",
          "variant": "section-title",
          "html": "<div class=\"section-title\"><span class=\"num\">八</span><h2>本期学习要求</h2></div>",
          "x": 568.3100000000001,
          "y": 585.8,
          "w": 508.9,
          "h": 24,
          "z": 477
        },
        {
          "id": "p1-7",
          "kind": "text",
          "variant": "req",
          "html": "<div class=\"req\">1. 熟练背诵两套独立答题模板，不混淆、不混用；</div>",
          "x": 568.3100000000001,
          "y": 613.8,
          "w": 508.9,
          "h": 20,
          "z": 485
        },
        {
          "id": "p1-8",
          "kind": "text",
          "variant": "req",
          "html": "<div class=\"req\">2. 能够手绘正常、厄尔尼诺、拉尼娜三种沃克环流图；</div>",
          "x": 568.3100000000001,
          "y": 637.8,
          "w": 508.9,
          "h": 20,
          "z": 493
        },
        {
          "id": "p1-9",
          "kind": "text",
          "variant": "req",
          "html": "<div class=\"req\">3. 掌握\"海气相互作用→环流变化→气候灾害\"完整因果链。</div>",
          "x": 568.3100000000001,
          "y": 661.8,
          "w": 508.9,
          "h": 20,
          "z": 501
        },
        {
          "id": "p1-10",
          "kind": "box",
          "variant": "name-row",
          "html": "<div class=\"name-row\"><span>姓名：</span><span>学号：</span></div>",
          "x": 568.3100000000001,
          "y": 685.8,
          "w": 508.9,
          "h": 21,
          "z": 509
        }
      ]
    },
    {
      "id": "page-mvj3ymbb-1q24",
      "els": [
        {
          "id": "el-mvj3ymbb-2qlq",
          "kind": "chrome",
          "variant": "header",
          "html": "<div class=\"header\"><div class=\"header-left\"><div class=\"header-title\">地理时政周刊 <span>GEO WEEKLY</span></div></div><div class=\"header-right\"><div class=\"issue\">第一期</div><div>2026.10.25</div></div></div>",
          "x": 45.3,
          "y": 37.8,
          "w": 1031.92,
          "h": 38,
          "z": 566
        },
        {
          "id": "el-mvj3ymbb-3u75",
          "kind": "chrome",
          "variant": "footer",
          "html": "<div class=\"footer\"><div class=\"footer-top\"><span>尺幅千里，卷纳乾坤</span><span class=\"center\">— 3 / 3 —</span><span>思接寰宇，笔绘山河</span></div><div class=\"footer-bottom\"><span>地理限时训练</span><span>使用日期：2026年10月26日</span><span>编辑：曹明环</span><span>核对：何文静</span></div></div>",
          "x": 45.3,
          "y": 733.2,
          "w": 1031.92,
          "h": 31,
          "z": 567
        },
        {
          "id": "p1-11",
          "kind": "chrome",
          "variant": "section-title",
          "html": "<div class=\"section-title\"><span class=\"num\">九</span><h2>配套高考真题变式习题（含标准答案）</h2></div>",
          "x": 45.3,
          "y": 83.8,
          "w": 508.9,
          "h": 24,
          "z": 517
        },
        {
          "id": "p1-12",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>一、选择题</h3>",
          "x": 45.3,
          "y": 111.8,
          "w": 508.9,
          "h": 21,
          "z": 525
        },
        {
          "id": "p1-13",
          "kind": "box",
          "variant": "quiz",
          "html": "<div class=\"quiz\"><p><strong>1. 厄尔尼诺现象发生期间，赤道太平洋区域正确的是（  ）</strong></p><p>A. 东南信风增强，沃克环流加强<br>             B. 秘鲁沿岸上升流减弱，渔业减产<br>             C. 澳大利亚北部降水增多<br>             D. 中东太平洋海水持续变冷</p><p><span class=\"ans\">答案：B</span> <span class=\"exp\">解析：厄尔尼诺信风减弱、沃克环流减弱；澳洲干旱；中东太平洋升温。</span></p></div>",
          "x": 45.3,
          "y": 136.8,
          "w": 508.9,
          "h": 146,
          "z": 533
        },
        {
          "id": "p1-14",
          "kind": "box",
          "variant": "quiz",
          "html": "<div class=\"quiz\"><p><strong>2. 拉尼娜事件发生年份，地理现象正确的是（  ）</strong></p><p>A. 我国冬季多暖冬<br>             B. 西北太平洋台风偏少<br>             C. 秘鲁渔场增产<br>             D. 我国次年夏季南涝北旱</p><p><span class=\"ans\">答案：C</span> <span class=\"exp\">解析：拉尼娜冷冬、台风偏多、次年南旱北涝、秘鲁渔获增产。</span></p></div>",
          "x": 45.3,
          "y": 286.8,
          "w": 508.9,
          "h": 146,
          "z": 541
        },
        {
          "id": "p1-15",
          "kind": "text",
          "variant": "subhead",
          "html": "<h3>二、综合大题（高考 8+6+6 分标准题型）</h3>",
          "x": 45.3,
          "y": 436.8,
          "w": 508.9,
          "h": 21,
          "z": 549
        },
        {
          "id": "p1-16",
          "kind": "box",
          "variant": "quiz",
          "html": "<div class=\"quiz\"><p>阅读材料，完成问题：</p><p>沃克环流是赤道太平洋纬向热力环流，海温异常会引发厄尔尼诺、拉尼娜现象，深刻影响全球气候与海洋生态。</p><p><strong>（1）简述厄尔尼诺现象的形成机制。（6 分）</strong></p><p><span class=\"ans\">标准答案：</span>东南信风减弱，西太平洋暖水向东迁移（2 分）；赤道中东太平洋上升补偿流减弱，冷水上泛减少，海水异常增温（2 分）；太平洋东西热力差异减小，沃克环流减弱甚至反转，形成厄尔尼诺现象（2 分）。</p><p><strong>（2）分析厄尔尼诺导致秘鲁渔场减产的原因。（6 分）</strong></p><p><span class=\"ans\">标准答案：</span>东南信风减弱，沿岸上升流减弱，海底营养盐类上泛减少（2 分）；浮游生物数量减少，鱼类饵料不足（2 分）；海水温度异常升高，冷水鱼类生存环境被破坏，鱼类大量死亡，渔场减产（2 分）。</p><p><strong>（3）说明厄尔尼诺次年夏季我国东部的旱涝格局及成因。（8 分）</strong></p><p><span class=\"ans\">标准答案：</span>格局：整体呈现南涝北旱（2 分）。成因：厄尔尼诺次年，西太平洋副热带高压位置偏南、势力偏强（2 分）；我国夏季风偏弱，锋面雨带北上速度慢、滞留南方时间长（2 分）；南方降水偏多易涝，北方雨季短、降水偏少易旱（2 分）。</p></div>",
          "x": 568.3100000000001,
          "y": 83.8,
          "w": 508.9,
          "h": 373,
          "z": 557
        }
      ]
    }
  ]
} as Doc
