# POI 插画素材 · 2026-10-22

为当前 Demo 的全部 18 个游戏地点生成独立的日式治愈水彩建筑插画。奶油白、鼠尾草绿、暖木色、陶土屋顶与植物细节，与猫咪、配送站及事件美术统一。

每张为 512×512 透明 WebP，按稳定地点 ID 映射。名称由地点注册表和当前地图锚点提供，**不烘焙在图片中**；不同模式下的地点重命名不会破坏图片映射。插画是游戏中的建筑意象，不是现实建筑的外观复原。

| 地点 ID | 插画主题 | 素材 |
| --- | --- | --- |
| `station` | 猫咪配送站 | [station.webp](station.webp) |
| `bakery` | 麦香面包坊 | [bakery.webp](bakery.webp) |
| `grocery` | 桥边杂货 | [grocery.webp](grocery.webp) |
| `fishsoup` | 胡须鱼汤 | [fishsoup.webp](fishsoup.webp) |
| `morning` | 晨光面包 | [morning.webp](morning.webp) |
| `florist` | 云雀花店 | [florist.webp](florist.webp) |
| `sakura` | 樱花公寓 | [sakura.webp](sakura.webp) |
| `school` | 银杏小学 | [school.webp](school.webp) |
| `office` | 街角商务楼 | [office.webp](office.webp) |
| `books` | 钟楼书店 | [books.webp](books.webp) |
| `pine` | 松风公寓 | [pine.webp](pine.webp) |
| `green` | 绿荫庭院 | [green.webp](green.webp) |
| `riverside` | 河畔文创楼 | [riverside.webp](riverside.webp) |
| `parkeast` | 公园东门 | [parkeast.webp](parkeast.webp) |
| `harbor` | 港湾小区 | [harbor.webp](harbor.webp) |
| `slope` | 坂道二丁目 | [slope.webp](slope.webp) |
| `tower` | 钟塔楼 | [tower.webp](tower.webp) |
| `alley` | 巷尾小屋 | [alley.webp](alley.webp) |

## 展示与交互

- `src/poiArt.js` 为灰盒与腾讯地图共用的图片、名称、可访问按钮与尺寸配置。
- 原圆点、立柱和配送站简易模型被插画替代。路网坐标、订单起终点、寻路、POI ID 及已有实地图层不变。
- 默认图片显示宽度约 104—132px；随视图缩放在 0.68—1.28 倍之间变化，刻意不遵循真实建筑比例。
- 名称仍由程序清晰绘制；悬停／聚焦放大，订单相关地点获得暖色高亮。点击与键盘激活沿用地点提示。
- 灰盒初始镜头为插画边界留出空间，腾讯视野边界增加展示余量；均不移动游戏锚点。
- 图片加载失败时保留名称与可操作按钮。纸箱、复杂路口等玩法提示不是游戏 POI，继续沿用已有表现。
- `manifest.json` 记录生成图和拆分区域；商务楼裁切区域避开了相邻画格的边缘残片。

## 预览

运行 Demo 后访问 `/art/poi/index.html`；子目录部署时加上站点前缀。

验证覆盖 18 张图片加载、初始全景、点击／键盘、路线高亮、滚轮缩放、素材失败回退和 844px 窗口。腾讯的 DOM 投影与缩放路径用确定性地图适配器验证，未在此环境配置 Key 访问实际腾讯底图。
