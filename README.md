# CS:WEB — 网页版反恐精英

用 Three.js + TypeScript 从零写的网页版 5v5 爆破模式 FPS，单人游玩，其余 9 个位置全部由 AI 补齐。
手感尽量贴近 CS:GO：急停、爆头倍率、压枪弹道、经济系统、买枪、拆装炸弹，一应俱全。

## 功能一览

- 5v5 爆破模式：T 方装包 / CT 方拆包，回合制，先赢 8 局获胜，第 8 局换边
- 三张经典图布局（单层简化版）：Dust（de_dust2）、Nuke（de_nuke）、Mirage（de_mirage）
- 三档人机难度：简单 / 普通 / 困难（反应、枪法、压枪、听觉都不同）
- 五把武器：刀、USP、AK-47、M4A4、AWP（含近似弹道图案、开镜、换弹）
- CS:GO 式移动手感：急停、静步、蹲下、空中转向，全部数值可调
- 经济系统：金钱、击杀/装包/拆包奖励、连败补偿、购买菜单（武器/护甲/拆弹钳）
- 人机 AI：A* 网格寻路、视线/听觉感知、攻守分工、会装包拆包守点
- 全合成音效（WebAudio，无外部音频文件）、枪口火光、弹道曳光、命中反馈、击杀播报
- 直接可分享：本地局域网 / 内网穿透 / 静态托管都能跑

## 快速开始

需要 Node.js 16+（推荐 18+）。

```bash
# 安装依赖
npm install

# 本地开发（默认 http://localhost:5173）
npm run dev

# 生产构建
npm run build
npm run preview
```

## 分享给别人玩

1. **局域网（同一 Wi-Fi 下的朋友）**

   ```bash
   npm run host
   ```

   然后让对方访问 `http://你的局域网IP:5173`。

2. **公网临时分享（无需服务器）**

   先 `npm run dev`，再任选一个内网穿透工具把 5173 端口映射出去：

   ```bash
   # Cloudflare 快速隧道（推荐，免费）
   cloudflared tunnel --url http://localhost:5173

   # 或 ngrok
   ngrok http 5173
   ```

   把生成的公网地址发给对方即可。

3. **永久部署（静态托管）**

   构建产物在 `dist/`，因为是相对路径，可直接拖到任意静态托管：

   ```bash
   npm run build
   ```

   然后上传 `dist/` 到 Netlify / Vercel / GitHub Pages 等平台。

4. **部署到 GitHub Pages（推荐）**

   项目里已配好 GitHub Actions 自动部署（`.github/workflows/deploy.yml`），只要把代码推到 GitHub 就能自动构建并发布：

   ```bash
   # 第一次：初始化并推送到 GitHub
   git init
   git add .
   git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/你的用户名/仓库名.git
   git push -u origin main
   ```

   然后在 GitHub 仓库的 **Settings → Pages** 里，把 Source 选成 **GitHub Actions**。之后每次 `git push` 都会自动构建部署，访问地址是：

   ```
   https://你的用户名.github.io/仓库名/
   ```

   之后想更新版本，只需 `git add . && git commit && git push`，网页会自动更新。

5. **直达对局链接**

   支持 URL 参数直接开局，分享时可用：

   ```
   http://地址/?map=nuke&diff=hard&team=CT
   ```

   `map`：`dust` / `nuke` / `mirage`；`diff`：`easy` / `normal` / `hard`；`team`：`T` / `CT` / `random`

## 操作说明

| 按键 | 功能 |
| --- | --- |
| WASD | 移动 |
| 鼠标 | 瞄准 |
| 左键 / 右键 | 开火 / 开镜 |
| R | 换弹 |
| Shift | 静步 |
| Ctrl | 蹲下 |
| 空格 | 跳跃 |
| 1 / 2 / 3 / 滚轮 | 主武器 / 手枪 / 刀 / 切换 |
| E | 装包 / 拆包 / 捡包（按住装拆） |
| B | 购买菜单 |
| Tab | 计分板 |
| M | 静音 |
| Esc | 暂停 |

## 调手感（重点）

所有数值都集中在 [src/config.ts](src/config.ts)，改完刷新即可生效：

- **移动**：`FEEL.walkSpeed`（跑速）、`accel` / `friction`（急停灵敏度）、`airAccel`（空中转向）、`jumpImpulse`、`gravity`
- **鼠标**：`FEEL.mouseSens`（灵敏度，数值越小越慢）
- **持枪速度**：每把武器的 `moveSpeed`（拿步枪比拿刀慢）
- **弹道**：每把武器的 `spreadBase`（首发精度）、`spreadMove`（移动散布）、`spreadShot`（连射散布）、`recoilPitch`（视角上抬）、`pattern`（压枪图案）
- **人机**：`BOT_DIFFICULTY` 里的 `aimError`（枪法）、`reactionMin/Max`（反应）、`burstMin/Max`（连发）、`fov` / `hearing`（感知）
- **对局**：`MATCH.roundTime`、`bombTime`、`winScore`、经济奖励等

控制台里也能直接改：启动后按 F12，输入 `window.__game.player.god = true` 可以开无敌，方便试枪和跑图。

## 代码结构

```
src/
  config.ts      手感/武器/人机/对局数值（调参总开关）
  movement.ts    Source 风格移动与碰撞
  maps.ts        地图定义（雕刻式布局）+ 导航网格 + A* 寻路
  models.ts      方块人/武器模型、地图场景、特效
  weapons.ts     武器状态机（射速、弹道、散布、换弹）
  player.ts      玩家控制器（视角、开火、武器动画）
  bots.ts        Bot AI（感知、状态机、战斗、装拆包）
  game.ts        回合/胜负/经济/炸弹/HUD/购买/记分板
  main.ts        主菜单与启动
  audio.ts       WebAudio 合成音效
```

## 已实现 vs 路线图

已实现：爆破模式、5v5 人机、三图、三档难度、五把武器、经济与购买、装拆包、胜负判定、换边、HUD/击杀播报/记分板。

后续可做（按优先级）：

1. 投掷物（闪光弹 / 烟雾弹 / 燃烧瓶）——需要给 Bot 增加相应的规避 AI
2. 联网对战（当前是单机，架构上玩家输入与渲染已分离，适合接 WebSocket 权威服务器）
3. 更多武器（P90、霰弹枪、AUG/SG553 等）与武器掉落
4. 更多地图 / 双层结构（Nuke 的上下层）
5. 皮肤与饰品（你说了先不管）
