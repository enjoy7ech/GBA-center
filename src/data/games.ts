import type { CheatRule } from '../emulator/types'

export type Game = {
  id: string
  title: string
  subtitle: string
  rom: string
  cover?: string
  color: string
  year?: string
  tags?: string[]
  cheats?: CheatRule[]
  credits?: { label: string; url: string }[]
}

/**
 * 在这里录入 ROM。ROM 放到 public/roms，封面放到 public/covers。
 *
 * 示例：
 * {
 *   id: 'example-game',
 *   title: '游戏名称',
 *   subtitle: 'GAME TITLE',
 *   rom: '/roms/example.gba',
 *   cover: '/covers/example.webp',
 *   color: '#ef5b49',
 *   year: '2004',
 *   tags: ['RPG', '中文'],
 * },
 */
export const games: Game[] = [
  {
    id: 'pokemon-unbound-v2-1-1-chs-revised',
    title: '宝可梦：解放',
    subtitle: 'POKÉMON UNBOUND v2.1.1',
    rom: '/roms/pokemon-unbound-v2-1-1-chs-revised.gba',
    cover: '/covers/pokemon-unbound-v2-1-1-chs-revised.png',
    color: '#6450a4',
    tags: ['RPG', '改版', '汉化修订'],
    cheats: [
      {
        id: 'pokemon-unbound-v2-1-1-max-money',
        name: '金钱 999999（生效后关闭）',
        code: '820257BC 423F+820257BE 000F',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-unbound-v2-1-1-mart-cost-one',
        name: '友好商店商品价格 1',
        code: '3C25A344 FD8F451C+AD86124F 2823D8DA',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-unbound-v2-1-1-rare-candy-first-ball-slot',
        name: '精灵球口袋首格变神奇糖果（用后关闭）',
        code: '000014D1 000A+4203C354 0044+00010001 0004',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-unbound-v2-1-1-master-ball-first-ball-slot',
        name: '精灵球口袋首格变大师球（用后关闭）',
        code: '000014D1 000A+4203C354 0001+00010001 0004',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-unbound-v2-1-1-guaranteed-catch',
        name: '100% 捕获（投球时开启，捕获后关闭）',
        code: '72023D74 9A93+82023D74 7861+72023D74 7861+82023D76 0896',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-unbound-v2-1-1-shiny-wild',
        name: '野生异色（捕获后关闭）',
        code: 'C34A5E26 58D1FACD+F935E412 9CD138A2+4270C392 40AA6F6F+AE649533 0ABCCE2C',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-unbound-v2-1-1-one-hit-ko',
        name: '一击必杀（仅战斗时开启）',
        code: '95EDFBBA A5A72A78+C833D1A0 02FA7205',
        enabled: false,
        builtIn: true,
      },
    ],
  },
  {
    id: 'pokemon-emerald-chs-us-v20120719',
    title: '口袋妖怪：绿宝石',
    subtitle: 'POKÉMON EMERALD',
    rom: '/roms/pokemon-emerald-chs-us-v20120719.gba',
    cover: '/covers/pokemon-emerald.png',
    color: '#169873',
    year: '2005',
    tags: ['RPG', '汉化', '美版 1.0'],
    cheats: [
      {
        id: 'pokemon-emerald-us-v1-anti-dma',
        name: '防 DMA（仅其他代码无效时开启）',
        code: 'B2809E31 3CEF5320+1C7B3231 B494738C',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-emerald-us-v1-max-money',
        name: '金钱 999999（生效后关闭）',
        code: '82000568 423F+8200056A 000F',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-emerald-us-v1-no-random-battles',
        name: '不遇野生宝可梦',
        code: '320375D4 0000',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-emerald-us-v1-rare-candy-mart-slot-one',
        name: '商店首项变神奇糖果（购买后关闭）',
        code: '82005274 0044',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-emerald-us-v1-master-ball-mart-slot-one',
        name: '商店首项变大师球（购买后关闭）',
        code: '82005274 0001',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-emerald-us-v1-battle-exp-999',
        name: '战后经验 999',
        code: '8202309C 03E7+820241F0 03E7',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-emerald-us-v1-infinite-pp',
        name: '战斗中 PP 不减',
        code: '42023070 6363+00000002 0002',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'pokemon-emerald-us-v1-guaranteed-catch',
        name: '100% 捕获（投球时开启，捕获后关闭）',
        code: '720207AE 0102+820055D4 0004+720207AE 0102+82024214 BD84',
        enabled: false,
        builtIn: true,
      },
    ],
  },
  {
    id: 'shining-soul-ii-chs',
    title: '光明之魂 II',
    subtitle: 'SHINING SOUL II',
    rom: '/roms/shining-soul-ii-chs.gba',
    cover: '/covers/shining-soul-ii-chs.png',
    color: '#d79732',
    year: '2003',
    tags: ['ARPG', '汉化'],
    cheats: [
      {
        id: 'shining-soul-ii-chs-bottom-right-money-999999',
        name: '右下格钱袋 999999（会覆盖该格道具）',
        code: '02003EC8:000A+02003ECC:000F423F',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'shining-soul-ii-chs-status-points-999',
        name: '能力点 999（生效后关闭）',
        code: '02003C12:03E7',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'shining-soul-ii-chs-skill-points-999',
        name: '技能点 999（生效后关闭）',
        code: '02003C28:03E7',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'shining-soul-ii-chs-infinite-hp',
        name: 'HP 不减',
        code: '03003E4C:03E7',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'shining-soul-ii-chs-infinite-sp',
        name: 'SP 不减',
        code: '03003E4A:2710',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'shining-soul-ii-chs-max-soul',
        name: 'SOUL 槽全满',
        code: '03003E4E:003C',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'shining-soul-ii-chs-resistances-200',
        name: '全抗性 200',
        code: '02003C1C:00C8+02003C1E:00C8+02003C20:00C8+02003C22:00C8+02003C24:00C8+02003C26:00C8',
        enabled: false,
        builtIn: true,
      },
    ],
  },
  {
    id: 'final-fantasy-vi-advance-chs',
    title: '最终幻想 VI Advance',
    subtitle: 'FINAL FANTASY VI ADVANCE',
    rom: '/roms/final-fantasy-vi-advance-chs.gba',
    cover: '/covers/final-fantasy-vi-advance.png',
    color: '#6f695f',
    year: '2007',
    tags: ['RPG', '汉化', '美版'],
    cheats: [
      {
        id: 'ff6a-us-max-gil',
        name: '金钱 9999999',
        code: '82001860 967F+32001862 0098',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'ff6a-us-no-world-map-encounters',
        name: '世界地图不遇敌',
        code: '82001F6E 0000',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'ff6a-us-fast-move-no-encounters',
        name: '快速移动 + 不遇敌',
        code: '320011DF 0022',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'ff6a-us-save-anywhere',
        name: '随时存档',
        code: '32001EB7 0086',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'ff6a-us-max-morph-time',
        name: '变身时间最大',
        code: '32001CF6 00FF',
        enabled: false,
        builtIn: true,
      },
    ],
  },
  {
    id: 'fire-emblem-the-blazing-blade-plus-v5-random',
    title: '火焰之纹章：烈火之剑 Plus+',
    subtitle: 'THE BLAZING BLADE PLUS+ v5.0',
    rom: '/roms/fire-emblem-the-blazing-blade-plus-v5-random.gba',
    cover: '/covers/fire-emblem-the-blazing-blade.png',
    color: '#c8472f',
    year: '2025',
    tags: ['SRPG', '改版', '随机成长'],
    credits: [
      {
        label: 'Bilibili：纸间旧梦',
        url: 'https://space.bilibili.com/3546861937887793',
      },
    ],
    cheats: [
      {
        id: 'fire-emblem-plus-v5-max-funds',
        name: '资金 999999',
        code: '8202BBFC 423F+8202BBFE 000F',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'fire-emblem-plus-v5-gold-gain-2x',
        name: '金币获得倍率 UP（2×）',
        code: '0800E814:F1F3+0800E816:F8F8+0800E836:F1F3+0800E838:F8E7+08023DB4:F1DD+08023DB6:FE2E+08201A08:0064+08201A0A:4B01+08201A0C:4718+08201A0E:46C0+08201A10:3D91+08201A12:0802+08201A14:2800+08201A16:DD00+08201A18:0040+08201A1A:4A01+08201A1C:4770+08201A1E:46C0+08201A20:BBF4+08201A22:0202',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'fire-emblem-plus-v5-exp-gain-2x',
        name: '经验获得倍率 UP（2×）',
        code: '0802A416:0064+0802A418:2C64+0802A41A:DD00+0802A41C:2464+0802A41E:1C20+0802A420:46C0+0802A422:46C0+0802A492:2028+0802A498:3028+0802A4FE:0052+0802A500:2A64+0802A502:DD00+0802A504:2264+0802A506:1C10+0802A508:BD10+0802A50A:46C0+0802A536:201E+0802A53C:301E',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'fire-emblem-plus-v5-first-unit-exp-99',
        name: '编队首位：经验 99（生效后关闭）',
        code: '3202BD55 0063',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'fire-emblem-plus-v5-first-unit-unlimited-actions',
        name: '编队首位：无限行动（教程/剧情禁用）',
        code: '3202BD58 0000',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'fire-emblem-plus-v5-infinite-weapon-durability',
        name: '武器/杖使用时耐久不减少',
        code: '08029964:46C0+08029966:46C0+0802AADC:46C0+0802AADE:46C0',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'fire-emblem-plus-v5-infinite-item-uses',
        name: '物品使用次数不减少',
        code: '0801882C:46C0+0801882E:46C0',
        enabled: false,
        builtIn: true,
      },
    ],
  },
  {
    id: 'golden-sun-the-broken-seal-chs',
    title: '黄金太阳：开启的封印',
    subtitle: 'GOLDEN SUN: THE BROKEN SEAL',
    rom: '/roms/golden-sun-the-broken-seal-chs.gba',
    cover: '/covers/golden-sun-the-broken-seal.png',
    color: '#d9a62e',
    year: '2001',
    tags: ['RPG', '汉化'],
    cheats: [
      {
        id: 'golden-sun-jp-max-coins',
        name: '金币 9999999',
        code: '82000250 967F+32000252 0098',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'golden-sun-jp-no-random-encounters',
        name: '无随机遇敌',
        code: '3200047A 0000',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'golden-sun-jp-always-dash',
        name: '始终奔跑',
        code: '3200045C 00FF',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'golden-sun-jp-battle-exp-5000',
        name: '战后经验 5000',
        code: '82030580 1388+32030582 0000',
        enabled: false,
        builtIn: true,
      },
      {
        id: 'golden-sun-jp-battle-coins-5000',
        name: '战后金币 5000',
        code: '8203057C 1388+3203057E 0000',
        enabled: false,
        builtIn: true,
      },
    ],
  },
]
