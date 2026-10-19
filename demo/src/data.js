// 《饿了喵》Demo 数据配置 —— 数值取自 PRD v0.3 的初始测试值

export const PALETTE = {
  paper: '#F5EBDD',
  sage: '#87977A',
  orange: '#D99A63',
  terracotta: '#B86750',
  brown: '#51463D',
  building: '#D9D8D1',
  water: '#A9C2C6',
};

// 距离一律以米计算；速度为游戏压缩值（游戏模拟时间，非真实步行速度）
// 场景单位换算由 graph.unitM 提供：灰盒 1 单位 = 10 米，真实地图 1 单位 = 1 米
export const BASE_SPEED_MPS = 15; // 米/秒，速度系数 1.0 时

export const SHIFT = {
  prep: 0,
  open: 240, // 接单阶段
  wrap: 180, // 收尾阶段上限
};

export const MAX_PENDING = 4;
export const ACCEPT_WINDOW = 55; // 待接单保留时间
export const EVENT_COOLDOWN = 60;
export const ENERGY_LOW = 30;

export const HANDOFF_BASE = 10;
export const HANDOFF_LAOBAN = 7;
export const HANDOFF_PATIENCE_EXTRA = 15;
export const LAOBAN_CROWD_DELAY = 6;

export const CATS = [
  {
    id: 'dundun',
    route: '#E0883A',
    name: '吨吨',
    breed: '橘猫',
    title: '可靠的大胃王',
    personality: '贪吃、可靠、慢热',
    speed: 0.9,
    capacity: 4,
    drain: 0.2,
    strength: '擅长重货与拼单',
    habit: '鱼汤任务更容易分心',
    colors: { body: '#E39A52', belly: '#F6E7D2', patch: '#C9773A', ear: '#E9A866', inner: '#F2B9A0', eye: '#7BA05B', bag: '#87977A', scarf: null },
    scale: 1.12,
    stories: [
      [0, '第一次见面时，吨吨把站里的鱼干柜闻了三遍。'],
      [10, '吨吨开始在出发前先看一眼站长，好像在确认：今天也有晚饭吧？'],
      [25, '工作记录：吨吨主动绕开了鱼汤店的后门。原因：它说自己在练习。'],
    ],
  },
  {
    id: 'shandian',
    route: '#D96C55',
    name: '闪电',
    breed: '狸花',
    title: '近路专家',
    personality: '机灵、急性子',
    speed: 1.2,
    capacity: 2,
    drain: 0.26,
    strength: '短程急单效率高',
    habit: '复杂转弯路段容易跑过头',
    colors: { body: '#9A8468', belly: '#E7DCC8', patch: '#5C4B3A', ear: '#8A7458', inner: '#E2A898', eye: '#A7B85A', bag: '#C9962E', scarf: '#E07A5F' },
    scale: 0.95,
    stories: [
      [0, '闪电第一天就找到了三条近路，其中两条是屋顶。'],
      [10, '闪电学会了在五岔路口前放慢一点。只是一点。'],
      [25, '工作记录：配送员在路口停下等站长提醒。等待时长：0.4 秒。'],
    ],
  },
  {
    id: 'laoban',
    route: '#5F8A57',
    name: '老板',
    breed: '三花',
    title: '从容的交接专家',
    personality: '从容、有边界感',
    speed: 1.0,
    capacity: 2,
    drain: 0.22,
    strength: '顾客交接更快',
    habit: '不喜欢拥挤取货点',
    colors: { body: '#F4EDE2', belly: '#FBF7F0', patch: '#2F2A27', patch2: '#D98A45', ear: '#2F2A27', inner: '#E8B2A2', eye: '#C9A33A', bag: '#87977A', scarf: '#8DA36E' },
    scale: 1.0,
    stories: [
      [0, '老板来站里的第一件事，是把自己的方巾叠整齐。'],
      [10, '老板记住了每位熟客喜欢的交接方式。它不说，但它记得。'],
      [25, '工作记录：老板拒绝在拥挤门口排队。顾客反馈：那我出来拿吧。'],
    ],
  },
  {
    id: 'mianmian',
    route: '#5E86B0',
    name: '绵绵',
    breed: '布偶猫',
    title: '客户关怀专员',
    personality: '温柔、亲人、从容',
    speed: 0.95,
    capacity: 2,
    drain: 0.22,
    strength: '化解特殊顾客的额外交接等待',
    habit: '送达后容易想多陪顾客一会儿',
    colors: { body: '#F3E8D9', belly: '#FFFAF2', patch: '#765442', ear: '#765442', inner: '#C98F7E', eye: '#659ABD', bag: '#8FA8BD', scarf: null },
    scale: 1.08,
    fluffy: true,
    stories: [
      [0, '送来的不只是晚饭，还有一小会儿陪伴。'],
      [10, '绵绵会在门口慢慢眨眼。很多顾客说，那一下让人安心。'],
      [25, '工作记录：配送准时。返站稍晚。顾客心情有所好转。'],
    ],
  },
];

export const CAT_BY_ID = Object.fromEntries(CATS.map((c) => [c.id, c]));

export const ORDER_TYPES = {
  bread: { id: 'bread', name: '面包', weight: 1, deadline: 90, reward: 24, focus: '时限较紧，适合快速配送' },
  soup: { id: 'soup', name: '鱼汤', weight: 2, deadline: 140, reward: 36, focus: '报酬高，存在鱼香诱惑' },
  grocery: { id: 'grocery', name: '杂货', weight: 2, deadline: 180, reward: 32, focus: '时限宽，适合负重与拼单' },
};

export const SHOP_ITEMS = [
  { id: 'snacks', name: '零食 ×3', price: 30, desc: '事件处理消耗品。没有零食时始终保留免费选项。', area: 'desk' },
  { id: 'jar', name: '密封罐', price: 120, desc: '装备后阻止该猫的鱼汤诱惑事件。', area: 'rack', equip: true },
  { id: 'raincoat', name: '防雨披', price: 120, desc: '装备后降低雨天移动惩罚（减速 20% → 5%）。', area: 'rack', equip: true },
  { id: 'bed', name: '软垫窝升级', price: 180, desc: '站内休息恢复效率 +60%。', area: 'bed', once: true },
  { id: 'desk', name: '订单台升级', price: 200, desc: '订单刷新更快，订单卡显示推荐配送员。', area: 'desk', once: true },
];

export const EQUIP_NAMES = { jar: '密封罐', raincoat: '防雨披' };

export const CUSTOMER_REVIEWS = {
  ontime: ['汤很热，送得很快。', '面包还是温的，谢谢小猫。', '准时到达，包装整齐。', '门口的爪印好可爱。', '送达提醒很礼貌。'],
  late: ['稍微晚了一点，不过小猫很认真。', '等得有点久，但东西很完整。', '看到小猫气喘吁吁，就不计较了。'],
};

export const CAT_REVIEWS = {
  dundun: ['鱼汤店门口的味道很好闻，但我忍住了。', '包很重，我很强壮。', '电梯有点可怕，但门口的地垫很好。', '今天的路，好像都通向晚饭。'],
  shandian: ['那个路口，我是故意多跑一段的。', '近路很近，下次还走。', '风很大，我更快。', '顾客说我是一道闪电。我同意。'],
  laoban: ['交接已完成，流程无误。', '取货点太挤了，不推荐。', '这位顾客懂得礼貌。', '我把方巾整理好了才出门。'],
  mianmian: ['她今天笑了两次。', '门口的灯很暖。', '我多坐了一会儿，路上的风很软。', '顾客说谢谢的时候，声音很轻。'],
};

export const BIRD_NOTES = [
  '观察记录：一只麻雀。麻雀尚未发现配送员。',
  '观察记录：两只白头鹎，交谈内容不明。',
  '观察记录：一只鸽子，体形可观，配送员表示尊重。',
  '观察记录：一只乌鸫。配送员认为它唱得还行。',
];

export const MIANMIAN_MESSAGES = [
  '「今天有点累，谢谢你陪我坐了一会儿。」',
  '「我家以前也有一只猫，毛也这么软。」',
  '「明天还会是你来吗？」',
  '「门口的灯我会一直开着的。」',
];

export const STORY = {
  title: '还是放在门口就好',
  customer: 'alley',
  stages: [
    {
      type: 'soup',
      note: '备注：请放在门口就好，不用敲门。',
      reveal: '门开了一条缝。里面的人没有露面，只轻轻说了句：「谢谢。」',
      title: '第一次 · 放在门口',
    },
    {
      type: 'soup',
      note: '备注：还是放在门口就好。可以……多要一份温热的吗？',
      reveal: '门边的地垫上，多了几枚很小很小的爪印。',
      title: '第二次 · 多一份温热',
    },
    {
      type: 'grocery',
      note: '备注：门口有一张便笺，请帮忙带回给站长。',
      reveal: '便笺上写着：「谢谢你们一直送来晚饭。孩子们已经会自己吃饭了。」——原来是一位照顾幼猫的猫妈妈。',
      title: '第三次 · 感谢便笺',
    },
  ],
};

export const TUTORIAL_TEXT = {
  start: '欢迎，新站长。点击右侧「麦香面包坊」的订单，安排吨吨完成第一单。',
  shandian: '狸花「闪电」加入了！派单时可以对比同一订单不同猫咪的预计耗时。',
  soup: '鱼汤订单出现了。注意：吨吨运送鱼汤容易分心，可以换猫或装备密封罐。',
  laoban: '三花「老板」加入，并开放「拼送」：一只猫最多同时承担两单，可调整取送顺序。',
  box: '事件出现时游戏会自动暂停。没有零食也可以选择免费处理方式。',
  firstShop: '班次结束！在配送站购买第一件装备吧。',
};
