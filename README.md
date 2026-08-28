# GBA Center

一个基于 React、Vite 与 mGBA WebAssembly 核心的浏览器 GBA 游戏中心。

## 开发

```bash
pnpm install
pnpm dev
```

项目直接加载 `public/cores` 中的 mGBA WebAssembly/libretro 核心，不包含第三方模拟器界面。构建产物无需联网即可运行核心。

模拟器页与 `NES-center` 保持同一套操作方式：

- 短按存档/读档打开槽位，长按使用快速槽；包含自动槽、快速槽和 8 个普通槽位。
- 存档保存在 IndexedDB，带画面缩略图、保存时间、长按删除，以及当前游戏的导入/导出。
- 1×/2×/5× 倍速、GameShark/CodeBreaker 金手指、自定义键盘映射和触屏震动。
- 移动端使用自研虚拟按键；GBA 在 NES 布局基础上增加 L、R 肩键。

## 录入游戏

1. 将合法备份的 `.gba` 文件放进 `public/roms/`。
2. 将封面图片放进 `public/covers/`（可选）。
3. 在 `src/data/games.ts` 的 `games` 数组里添加游戏信息。

```ts
{
  id: 'example-game',
  title: '游戏名称',
  subtitle: 'GAME TITLE',
  rom: '/roms/example.gba',
  cover: '/covers/example.webp',
  color: '#ef5b49',
  year: '2004',
  tags: ['RPG', '中文'],
}
```


## 目录

```text
src/
├─ data/games.ts                  # 游戏目录
├─ emulator/mgbaCoreAdapter.ts    # mGBA 核心适配层
├─ App.tsx                        # 首页、模拟器页及轻量路由
└─ styles.css                     # 响应式视觉与布局
public/
├─ roms/                          # ROM（不应提交无授权内容）
├─ covers/                        # 游戏封面
└─ cores/                         # mGBA WebAssembly 核心
```

画布、输入、存档、读档、倍速、金手指和全部界面均由 GBA Center 实现；mGBA 只负责运行游戏。

请仅使用你拥有合法权利的 ROM 备份。
