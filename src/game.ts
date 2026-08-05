import * as THREE from 'three';
import { MATCH, BOT_DIFFICULTY, WEAPONS, FEEL, type DifficultyKey, type Team } from './config';
import { MovementController } from './movement';
import { getMap, type MapSite } from './maps';
import { buildWorldScene, createBombMesh } from './models';
import { PlayerController, type InputState } from './player';
import { Bot, attachBotWorldMap, type EnemyRef } from './bots';
import { sfx } from './audio';
import { NadeProjectile, NADES, NADE_TYPES, type Detonation, type NadeType } from './throwables';

export interface GameOptions {
  mapId: string;
  difficulty: DifficultyKey;
  team: Team | 'random';
}

const BOT_NAMES = ['雷克斯', '赛斯', '艾达', '科尔', '米娅', '诺亚', '岚', '铁锤', '幽狐'];

type Combatant = PlayerController | Bot;

function entName(e: Combatant): string {
  return e.isPlayer ? '玩家' : e.name;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private map = getMap('dust');
  private player: PlayerController;
  private bots: Bot[] = [];
  private input: InputState = {
    keys: new Set(),
    mouseDX: 0,
    mouseDY: 0,
    fire: false,
    rmb: false,
    wheel: 0,
    interact: false,
    reload: false,
    buy: false,
    slot: 0,
    scoreboard: false,
  };

  private difficulty: DifficultyKey;
  private playerTeam: Team;
  private round = 1;
  private score = { t: 0, ct: 0 };
  private lossStreak = { t: 0, ct: 0 };
  private phase: 'freeze' | 'live' | 'ended' | 'matchover' = 'freeze';
  private phaseT = 0;
  private roundT = MATCH.roundTime;

  private bomb: {
    planted: boolean;
    pos: THREE.Vector3;
    time: number;
    dropped: THREE.Vector3 | null;
    mesh: THREE.Group;
    beepT: number;
  };
  private playerInteract: { type: 'plant' | 'defuse' | null; t: number; total: number } = { type: null, t: 0, total: 0 };

  private tracers: Array<{ line: THREE.Line; life: number }> = [];
  private bloods: Array<{ mesh: THREE.Mesh; vel: THREE.Vector3; life: number }> = [];
  private killFeed: Array<{ el: HTMLDivElement; t: number }> = [];
  private hitmarkerT = 0;
  private damageFlash = 0;
  private bombAlert = 0;
  private explosionFlash = 0;
  private paused = false;
  private lastLockExit = 0;
  private spectateBot: Bot | null = null;
  private projectiles: NadeProjectile[] = [];
  private smokes: Array<{ pos: THREE.Vector3; radius: number; t: number; mesh: THREE.Mesh }> = [];
  private fires: Array<{ pos: THREE.Vector3; radius: number; t: number; mesh: THREE.Mesh; tickT: number; light: THREE.PointLight; owner: string }> = [];
  private effects: Array<{ mesh: THREE.Object3D; t: number; max: number; light?: THREE.PointLight }> = [];
  private nadeSelect: NadeType | null = null;
  private nadeCookT = 0;
  private prevFire = false;
  private prevSlot: 'primary' | 'secondary' | 'melee' = 'secondary';
  private flashOverlay = 0;
  private minimap!: HTMLCanvasElement;
  private minimapCtx!: CanvasRenderingContext2D;
  private minimapStatic!: HTMLCanvasElement;
  private raf = 0;
  private clock = new THREE.Clock();
  private disposed = false;
  private onQuit: () => void;
  private onRestart: () => void;

  // HUD DOM
  private hud!: HTMLDivElement;
  private el = {
    timer: null as unknown as HTMLDivElement,
    score: null as unknown as HTMLDivElement,
    round: null as unknown as HTMLDivElement,
    health: null as unknown as HTMLDivElement,
    armor: null as unknown as HTMLDivElement,
    money: null as unknown as HTMLDivElement,
    ammo: null as unknown as HTMLDivElement,
    weaponName: null as unknown as HTMLDivElement,
    nadeHud: null as unknown as HTMLDivElement,
    nadeCook: null as unknown as HTMLDivElement,
    nadeCookBar: null as unknown as HTMLDivElement,
    flashOverlay: null as unknown as HTMLDivElement,
    smokeOverlay: null as unknown as HTMLDivElement,
    buyToast: null as unknown as HTMLDivElement,
    teamStatus: null as unknown as HTMLDivElement,
    scope: null as unknown as HTMLDivElement,
    bombStatus: null as unknown as HTMLDivElement,
    killfeed: null as unknown as HTMLDivElement,
    interact: null as unknown as HTMLDivElement,
    progress: null as unknown as HTMLDivElement,
    progressBar: null as unknown as HTMLDivElement,
    banner: null as unknown as HTMLDivElement,
    damage: null as unknown as HTMLDivElement,
    hitmarker: null as unknown as HTMLDivElement,
    buyMenu: null as unknown as HTMLDivElement,
    buyItems: null as unknown as HTMLDivElement,
    buyMoney: null as unknown as HTMLDivElement,
    scoreboard: null as unknown as HTMLDivElement,
    scoreboardTitle: null as unknown as HTMLDivElement,
    scoreboardBody: null as unknown as HTMLDivElement,
    death: null as unknown as HTMLDivElement,
    pause: null as unknown as HTMLDivElement,
    bombIcon: null as unknown as HTMLDivElement,
  };

  constructor(canvas: HTMLCanvasElement, opts: GameOptions, onQuit: () => void, onRestart: () => void = onQuit) {
    this.onQuit = onQuit;
    this.onRestart = onRestart;
    this.difficulty = opts.difficulty;
    this.playerTeam = opts.team === 'random' ? (Math.random() < 0.5 ? 'T' : 'CT') : opts.team;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.loadMap(opts.mapId);

    this.player = new PlayerController(this.scene, this.map.brushes, this.playerTeam);
    this.bomb = {
      planted: false,
      pos: new THREE.Vector3(),
      time: MATCH.bombTime,
      dropped: null,
      mesh: createBombMesh(),
      beepT: 0,
    };
    this.bomb.mesh.visible = false;
    this.scene.add(this.bomb.mesh);

    // 9 个 Bot：4 同队 + 5 敌队
    for (let i = 0; i < 9; i++) {
      const team: Team = i < 4 ? this.playerTeam : (this.playerTeam === 'T' ? 'CT' : 'T');
      const bot = new Bot(BOT_NAMES[i], team, BOT_DIFFICULTY[this.difficulty], this.map.brushes);
      attachBotWorldMap(bot, this.map);
      this.bots.push(bot);
      this.scene.add(bot.model.group);
    }

    this.buildHud();
    this.bindEvents(canvas);
    this.startRound();
    this.loop();
    // 调试/调手感入口：控制台可访问 window.__game
    (window as unknown as { __game?: Game }).__game = this;
    (window as unknown as { __THREE?: typeof THREE }).__THREE = THREE;
  }

  // ============================================================
  private loadMap(id: string) {
    this.map = getMap(id);
    const built = buildWorldScene(this.map);
    this.scene.add(built.group);
    this.scene.background = new THREE.Color(0xc9c2ae);
    this.scene.fog = new THREE.Fog(0xc9c2ae, 900, 4200);
  }

  private usedSpawnIdx: { t: number[]; ct: number[] } = { t: [], ct: [] };

  private pickSpawn(team: Team): THREE.Vector3 {
    const key = team === 'T' ? 't' : 'ct';
    const list = team === 'T' ? this.map.spawns.t : this.map.spawns.ct;
    const used = this.usedSpawnIdx[key];
    const avail: number[] = [];
    for (let i = 0; i < list.length; i++) if (!used.includes(i)) avail.push(i);
    const idx = avail.length ? avail[Math.floor(Math.random() * avail.length)] : Math.floor(Math.random() * list.length);
    used.push(idx);
    return list[idx].clone();
  }

  // ============================================================
  // 回合流程
  // ============================================================

  private teamOf(team: Team): 't' | 'ct' {
    return team === 'T' ? 't' : 'ct';
  }

  private startRound() {
    const half = this.round <= MATCH.halfRounds;
    const playerTeam = half ? this.playerTeam : (this.playerTeam === 'T' ? 'CT' : 'T');
    this.usedSpawnIdx = { t: [], ct: [] };
    this.phase = 'freeze';
    this.phaseT = MATCH.freezeTime;
    this.roundT = MATCH.roundTime;
    this.bomb.planted = false;
    this.bomb.dropped = null;
    this.bomb.mesh.visible = false;
    this.playerInteract = { type: null, t: 0, total: 0 };
    this.buyAuto = true;
    this.buyOpen = false;
    this.el.buyMenu.style.display = 'none';
    // 清空上一回合的投掷物/烟雾/火焰
    this.nadeSelect = null;
    this.nadeCookT = 0;
    this.flashOverlay = 0;
    this.projectiles.length = 0;
    for (const s of this.smokes) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    this.smokes.length = 0;
    for (const f of this.fires) {
      this.scene.remove(f.mesh);
      this.scene.remove(f.light);
      f.mesh.geometry.dispose();
      (f.mesh.material as THREE.Material).dispose();
    }
    this.fires.length = 0;
    for (const e of this.effects) {
      this.scene.remove(e.mesh);
      if (e.light) this.scene.remove(e.light);
    }
    this.effects.length = 0;

    // 玩家（换边时 CS:GO 规则不保留武器）
    const keepWeapons = this.player.alive && this.player.health > 0 && playerTeam === this.player.team;
    this.spectateBot = null;
    this.player.viewmodel.visible = true;
    for (const c of this.player.camera.children) {
      if ((c as THREE.Sprite).isSprite) c.visible = true;
    }
    const playerSpawn = this.pickSpawn(playerTeam);
    const faceSpawn = (pos: THREE.Vector3) => {
      // 面向离自己最近的包点，而不是直勾勾对着对面出生点
      let best = this.map.sites[0].pos;
      let bestD = Infinity;
      for (const s of this.map.sites) {
        const d = s.pos.distanceToSquared(pos);
        if (d < bestD) {
          bestD = d;
          best = s.pos;
        }
      }
      return Math.atan2(pos.x - best.x, pos.z - best.z);
    };
    this.player.reset(playerSpawn, playerTeam, this.player.money, keepWeapons, faceSpawn(playerSpawn));
    this.player.hasBomb = false;
    this.player.hasKit = false;
    this.player.armor = 0;

    // Bot 阵营
    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      const botTeam: Team = i < 4 ? playerTeam : (playerTeam === 'T' ? 'CT' : 'T');
      const botSpawn = this.pickSpawn(botTeam);
      bot.reset(
        botSpawn,
        botTeam,
        bot.money,
        'siteA',
        'A',
        bot.alive && bot.health > 0 && botTeam === bot.team,
        faceSpawn(botSpawn),
      );
      bot.armor = 0;
    }

    // 阵营角色分配
    const tBots = this.bots.filter((b) => b.team === 'T');
    const ctBots = this.bots.filter((b) => b.team === 'CT');
    const allT = this.player.team === 'T' ? [this.player, ...tBots] : tBots;
    const allCT = this.player.team === 'CT' ? [this.player, ...ctBots] : ctBots;
    // 炸弹携带者（T 方随机一个）
    const carrier = allT[Math.floor(Math.random() * allT.length)];
    const carrierSite: 'A' | 'B' = Math.random() < 0.5 ? 'A' : 'B';
    carrier.hasBomb = true;
    // T 分工：2 人跟包点，2 人另一包点
    const siteSplit: Array<'A' | 'B'> = [carrierSite, carrierSite, carrierSite === 'A' ? 'B' : 'A', carrierSite === 'A' ? 'B' : 'A'];
    tBots.forEach((b, i) => {
      b.siteChoice = siteSplit[i % siteSplit.length];
      b.role = 'siteA';
    });
    // CT 分工：2 A、2 B、1 中路
    const ctRoles: Array<'siteA' | 'siteB' | 'mid'> = ['siteA', 'siteA', 'siteB', 'siteB', 'mid'];
    ctBots.forEach((b, i) => {
      b.role = ctRoles[i % ctRoles.length];
      b.siteChoice = b.role === 'siteB' ? 'B' : 'A';
    });

    // 买装备
    for (const b of this.bots) b.buy();

    // 重置胜负显示
    this.banner('', '');
    this.el.death.style.display = 'none';
    this.closeBuyMenu();
    sfx.play('round_start');
  }

  private endRound(winner: Team, reason: string) {
    if (this.phase === 'ended' || this.phase === 'matchover') return;
    this.phase = 'ended';
    this.phaseT = 4.5;
    const w = this.teamOf(winner);
    this.score[w]++;
    const loser: 't' | 'ct' = w === 't' ? 'ct' : 't';

    // 经济结算
    const bombWin = reason === 'bomb_explode';
    for (const b of this.bots) {
      if (b.team === winner) {
        b.money += bombWin ? MATCH.bombWinReward : MATCH.winReward;
      } else {
        b.money += Math.min(MATCH.lossBonusCap, MATCH.lossBonusBase + this.lossStreak[loser] * MATCH.lossBonusStep);
      }
    }
    if (this.player.team === winner) {
      this.player.money += bombWin ? MATCH.bombWinReward : MATCH.winReward;
    } else {
      this.player.money += Math.min(MATCH.lossBonusCap, MATCH.lossBonusBase + this.lossStreak[loser] * MATCH.lossBonusStep);
    }
    this.lossStreak[w] = 0;
    this.lossStreak[loser]++;

    this.banner(winner === 'T' ? 'T 阵营胜利' : 'CT 阵营胜利', reasonText(reason));
    sfx.play(winner === this.player.team ? 'round_win' : 'round_lose');

    if (this.score[w] >= MATCH.winScore) {
      // 不在这里立刻结束：让“回合结束”横幅展示 4.5 秒后，由 update() 统一进入结算
    }
  }

  private showMatchOver() {
    const winner: Team = this.score.t >= MATCH.winScore ? 'T' : 'CT';
    this.banner('比赛结束', `${winner} 阵营以 ${this.score.t}:${this.score.ct} 获胜`);
    // 最终计分板
    this.renderScoreboard();
    this.el.scoreboardTitle.textContent = '比赛结束 · 最终比分';
    this.el.scoreboard.style.display = 'flex';
    // 结束面板：标题从“已暂停”换成“比赛结束”，只保留再来一局/返回主菜单
    const h2 = this.el.pause.querySelector('h2');
    if (h2) h2.textContent = '比赛结束';
    const resume = this.hud.querySelector<HTMLElement>('#resume-btn')!;
    resume.style.display = 'none';
    const restart = this.hud.querySelector<HTMLElement>('#restart-btn')!;
    restart.style.display = 'block';
    this.el.pause.style.display = 'flex';
  }

  // ============================================================
  // 主更新
  // ============================================================

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.paused && this.phase !== 'matchover') {
      this.update(dt);
    }
    this.renderer.render(this.scene, this.player.camera);
  };

  private update(dt: number) {
    if (this.phase === 'matchover') return;
    this.noiseEvents.length = 0;
    this.phaseT -= dt;

    // 回合计时
    if (this.phase === 'live') {
      this.roundT -= dt;
    } else if (this.phase === 'freeze' && this.phaseT <= 0) {
      this.phase = 'live';
      this.phaseT = 999;
      this.banner('', '');
    } else if (this.phase === 'ended' && this.phaseT <= 0) {
      if (this.score.t >= MATCH.winScore || this.score.ct >= MATCH.winScore) {
        this.phase = 'matchover';
        this.showMatchOver();
        return;
      }
      this.round++;
      this.startRound();
      return;
    }

    // ---- 玩家输入与移动 ----
    this.scene.updateMatrixWorld(true);
    const p = this.player;
    p.lockMove = this.phase !== 'live';
    if (p.alive) {
      p.update(dt, this.input);
      this.handlePlayerShoot();
      this.handlePlayerInteract();
      this.updateNades(dt);
    } else {
      // 死亡后进入队友视角（无队友时自由视角）
      this.updateSpectate(dt);
    }

    // ---- Bot ----
    const enemiesOfT = this.buildEnemyRefs('CT');
    const enemiesOfCT = this.buildEnemyRefs('T');
    const world = {
      map: this.map,
      brushes: this.map.brushes,
      bombPlanted: this.bomb.planted,
      bombPos: this.bomb.pos,
      bombTimeLeft: this.bomb.time,
      bombDropped: this.bomb.dropped,
      noises: this.collectNoises(dt),
      time: this.roundT,
      smokes: this.smokes.map((s) => ({ pos: s.pos, radius: s.radius })),
    };

    for (const bot of this.bots) {
      bot.lockMove = this.phase !== 'live';
      if (!bot.alive) {
        bot.update(dt, world, []);
        continue;
      }
      const enemies = bot.team === 'T' ? enemiesOfT : enemiesOfCT;
      bot.update(dt, world, enemies);
      if (bot.actions.shot) {
        this.resolveShot(bot.actions.shot.origin, bot.actions.shot.dir, bot.team, bot);
        this.noiseEvents.push({ pos: bot.move.pos.clone(), radius: 2600 });
      }
      if (bot.actions.nade) {
        const nd = bot.actions.nade;
        this.projectiles.push(new NadeProjectile(nd.type, bot.team, bot.name, bot.eyePos, nd.dir, bot.move.vel, nd.cook));
        sfx.play('nade_throw');
        this.noiseEvents.push({ pos: bot.move.pos.clone(), radius: 1400 });
        bot.actions.nade = null;
      }
      if (bot.actions.plant && bot.actions.plantProgress >= 1) this.doPlant(bot);
      if (bot.actions.defuse && bot.actions.defuseProgress >= 1) this.doDefuse();
      // 捡包
      if (this.bomb.dropped && bot.team === 'T' && bot.hasBomb === false) {
        if (bot.move.pos.distanceTo(this.bomb.dropped) < 110) {
          bot.hasBomb = true;
          this.bomb.dropped = null;
          this.bomb.mesh.visible = false;
          sfx.play('buy');
        }
      }
    }

    // 玩家捡包
    if (this.bomb.dropped && p.alive && p.team === 'T' && !p.hasBomb) {
      if (p.move.pos.distanceTo(this.bomb.dropped) < 110) {
        p.hasBomb = true;
        this.bomb.dropped = null;
        this.bomb.mesh.visible = false;
        sfx.play('buy');
      }
    }

    // ---- 炸弹 ----
    this.updateBomb(dt);

    // ---- 胜负判定 ----
    this.checkWinCondition();

    // ---- 特效 ----
    this.updateEffects(dt);
    this.updateProjectiles(dt);
    this.updateSmokes(dt);
    this.updateFires(dt);
    this.updateVisionOverlays(dt);
    this.drawMinimap();
    this.updateHud(dt);
  }

  private pitchLookOnly(dt: number) {
    const sens = FEEL.mouseSens;
    this.player.yaw -= this.input.mouseDX * sens;
    this.player.pitch = Math.max(-1.55, Math.min(1.55, this.player.pitch - this.input.mouseDY * sens));
    this.input.mouseDX = 0;
    this.input.mouseDY = 0;
    const p = this.player;
    p.camera.rotation.order = 'YXZ';
    p.camera.rotation.y = p.yaw;
    p.camera.rotation.x = p.pitch;
    void dt;
  }

  // ---------- 死亡后队友视角 ----------

  private startSpectate() {
    this.player.viewmodel.visible = false;
    for (const c of this.player.camera.children) {
      if ((c as THREE.Sprite).isSprite) c.visible = false;
    }
    // 观战时不再显示“你已阵亡”遮罩
    this.el.death.style.display = 'none';
    this.player.camera.fov = 68;
    this.player.camera.updateProjectionMatrix();
    const mates = this.bots.filter((b) => b.team === this.player.team && b.alive);
    if (!mates.length) {
      this.spectateBot = null;
      return;
    }
    // 优先观战距离自己最近的队友
    mates.sort(
      (a, b) =>
        a.move.pos.distanceToSquared(this.player.move.pos) -
        b.move.pos.distanceToSquared(this.player.move.pos),
    );
    this.spectateBot = mates[0];
  }

  private cycleSpectate() {
    const mates = this.bots.filter((b) => b.team === this.player.team && b.alive);
    if (!mates.length) {
      this.spectateBot = null;
      return;
    }
    if (!this.spectateBot || !this.spectateBot.alive) {
      this.spectateBot = mates[0];
      return;
    }
    const idx = mates.indexOf(this.spectateBot);
    this.spectateBot = mates[(idx + 1) % mates.length];
  }

  private updateSpectate(dt: number) {
    this.input.mouseDX = 0;
    this.input.mouseDY = 0;
    const mates = this.bots.filter((b) => b.team === this.player.team && b.alive);
    if (!mates.length) {
      this.spectateBot = null;
      // 没有队友可看时，恢复阵亡提示
      this.el.death.style.display = 'flex';
      this.pitchLookOnly(dt);
      return;
    }
    if (!this.spectateBot || !this.spectateBot.alive) {
      this.spectateBot = mates[0];
    }
    const cam = this.player.camera;
    cam.position.copy(this.spectateBot.eyePos);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.spectateBot.viewYaw;
    cam.rotation.x = this.spectateBot.viewPitch;
    cam.rotation.z = 0;
    // 队友开镜时跟随缩放
    const bw = this.spectateBot.weapon;
    const targetFov = bw.scoped && bw.def.zoom ? bw.def.zoom : 68;
    cam.fov += (targetFov - cam.fov) * Math.min(1, FEEL.zoomSpeed * dt);
    cam.updateProjectionMatrix();
  }

  private buildEnemyRefs(team: Team): EnemyRef[] {
    const refs: EnemyRef[] = [];
    if (this.player.team === team && this.player.alive) {
      refs.push({
        pos: this.player.move.pos,
        vel: this.player.move.vel,
        alive: this.player.alive,
        isPlayer: true,
      });
    }
    for (const b of this.bots) {
      if (b.team === team && b.alive) {
        refs.push({ pos: b.move.pos, vel: b.move.vel, alive: b.alive, isPlayer: false });
      }
    }
    return refs;
  }

  private noiseEvents: Array<{ pos: THREE.Vector3; radius: number }> = [];
  private collectNoises(_dt: number): Array<{ pos: THREE.Vector3; radius: number }> {
    return this.noiseEvents;
  }

  // ============================================================
  // 射击与命中
  // ============================================================

  private handlePlayerShoot() {
    const p = this.player;
    if (this.input.buy) {
      this.toggleBuyMenu();
      this.input.buy = false;
    }
    if (this.buyOpen) return; // 购买菜单打开时不能开火/换弹
    if (this.nadeSelect) return; // 投掷物模式下不射击
    const dir = new THREE.Vector3();
    p.camera.getWorldDirection(dir);
    if (this.input.fire && p.alive && this.phase === 'live') {
      const { fired } = p.shoot(dir);
      if (fired) {
        this.resolveShot(p.eyePosition, dir, p.team, p);
        this.noiseEvents.push({ pos: p.move.pos.clone(), radius: 2600 });
      }
    }
    if (this.input.reload) {
      const w = p.weapon;
      if (!w.isKnife && !w.reloading && w.ammoInMag < w.def.magSize && w.reserve > 0) {
        w.startReload();
        sfx.play('reload');
      }
      this.input.reload = false;
    }
    if (this.input.slot !== 0) {
      const s = this.input.slot;
      p.switchSlot(s === 1 ? 'primary' : s === 2 ? 'secondary' : 'melee');
      this.input.slot = 0;
    }
    if (this.input.wheel !== 0) {
      p.cycleWeapon(this.input.wheel > 0 ? 1 : -1);
      this.input.wheel = 0;
    }
    if (this.input.interact) {
      this.input.interact = false;
      if (this.bomb.dropped && p.alive && p.team === 'T' && !p.hasBomb) {
        if (p.move.pos.distanceTo(this.bomb.dropped) < 90) {
          p.hasBomb = true;
          this.bomb.dropped = null;
          this.bomb.mesh.visible = false;
          sfx.play('buy');
        }
      }
    }
  }

  private resolveShot(origin: THREE.Vector3, dir: THREE.Vector3, shooterTeam: Team, shooter: Combatant) {
    const w = shooter.weapon;
    if (w.def.knife) {
      // 近战：球形判定
      this.resolveMelee(origin, dir, shooterTeam, shooter);
      return;
    }
    const maxDist = 8192;
    const worldHit = MovementController.raycastBrushes(this.map.brushes, origin, dir, maxDist);

    // 敌人受击盒
    const meshes: THREE.Mesh[] = [];
    const meshOwner = new Map<THREE.Mesh, { hitbox: { part: string; mult: number }; entity: Combatant }>();
    const addEntity = (entity: Combatant, hitboxes: Array<{ mesh: THREE.Mesh; part: string; mult: number }>) => {
      for (const hb of hitboxes) {
        meshes.push(hb.mesh);
        meshOwner.set(hb.mesh, { hitbox: hb, entity });
      }
    };
    if (this.player.team !== shooterTeam && this.player.alive) {
      addEntity(this.player, this.player.hitboxes);
    }
    for (const b of this.bots) {
      if (b.team !== shooterTeam && b.alive) {
        addEntity(b, b.model.hitboxes);
      }
    }

    const raycaster = new THREE.Raycaster(origin, dir, 0, Math.min(worldHit, maxDist));
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const first = hits[0];
      const owner = meshOwner.get(first.object as THREE.Mesh)!;
      const headshot = owner.hitbox.part === 'head';
      let dmg = WEAPONS[w.def.id].damage;
      if (headshot) dmg *= WEAPONS[w.def.id].headMult;
      if (owner.hitbox.mult !== 1) dmg *= owner.hitbox.mult;
      if (owner.entity.armor > 0) {
        dmg *= headshot ? WEAPONS[w.def.id].armorHeadMult : WEAPONS[w.def.id].armorBodyMult;
      }
      this.dealDamage(owner.entity, Math.max(1, Math.round(dmg)), shooter, headshot, first.point);
      this.spawnTracer(origin, first.point);
      return;
    }
    // 打到墙
    const end = origin.clone().addScaledVector(dir, worldHit);
    this.spawnTracer(origin, end);
    this.spawnImpact(end, 0);
  }

  private resolveMelee(origin: THREE.Vector3, dir: THREE.Vector3, shooterTeam: Team, shooter: Combatant) {
    let best: { entity: Combatant; dist: number; point: THREE.Vector3 } | null = null;
    const targets: Combatant[] = [];
    if (this.player.team !== shooterTeam && this.player.alive) targets.push(this.player);
    for (const b of this.bots) if (b.team !== shooterTeam && b.alive) targets.push(b);
    for (const e of targets) {
      const d = origin.distanceTo(e.move.pos);
      if (d < 120) {
        const to = new THREE.Vector3().subVectors(e.move.pos, origin).normalize();
        if (dir.dot(to) > 0.4 && (!best || d < best.dist)) {
          best = { entity: e, dist: d, point: e.move.pos.clone().add(new THREE.Vector3(0, 40, 0)) };
        }
      }
    }
    if (best) {
      this.dealDamage(best.entity, 65, shooter, false, best.point);
      this.spawnTracer(origin, best.point);
      this.spawnBlood(best.point);
    }
  }

  private dealDamage(entity: Combatant, dmg: number, shooter: Combatant, headshot: boolean, point: THREE.Vector3) {
    const isPlayer = entity.isPlayer;
    const shooterIsPlayer = shooter.isPlayer;
    if (isPlayer) {
      const p = this.player;
      if (!p.alive) return;
      if (p.armor > 0) p.armor = Math.max(0, p.armor - dmg * 0.35);
      p.applyDamage(dmg);
      this.damageFlash = Math.min(1, this.damageFlash + dmg / 120);
      this.spawnBlood(point);
      if (!p.alive && shooter) {
        this.killCredit(shooter, p);
        this.dropBombIfCarrier(p);
        this.el.death.style.display = 'flex';
        this.startSpectate();
      }
    } else {
      const bot = entity as Bot;
      if (!bot.alive) return;
      if (bot.armor > 0) bot.armor = Math.max(0, bot.armor - dmg * 0.35);
      bot.applyDamage(dmg);
      this.spawnBlood(point);
      if (!bot.alive) {
        this.killCredit(shooter, bot);
        this.dropBombIfCarrier(bot);
      }
    }
    if (shooterIsPlayer) {
      this.hitmarkerT = 0.12;
      sfx.play('hitmarker');
      if (headshot) sfx.play('headshot');
    }
  }

  private killCredit(shooter: Combatant, victim: Combatant) {
    shooter.kills++;
    if (shooter.isPlayer) {
      this.player.money += MATCH.killReward;
      sfx.play('kill');
    } else {
      shooter.money += MATCH.killReward;
    }
    this.addKillFeed(entName(shooter), entName(victim), shooter.team);
  }

  private dropBombIfCarrier(e: Combatant) {
    if (e.hasBomb) {
      e.hasBomb = false;
      this.bomb.dropped = e.move.pos.clone();
      this.bomb.dropped.y = 0;
      // 吸附到最近可通行格子，避免掉进墙里捡不到
      const tile = this.map.nav.worldToTile(this.bomb.dropped);
      const alt = this.map.nav.nearestWalkable(tile.x, tile.z);
      if (alt) this.bomb.dropped.copy(this.map.nav.tileToWorld(alt.x, alt.z));
      this.bomb.mesh.position.copy(this.bomb.dropped);
      this.bomb.mesh.visible = true;
    }
  }

  // ============================================================
  // 炸弹
  // ============================================================

  private handlePlayerInteract() {
    const p = this.player;
    if (!p.alive || !this.input.keys.has('KeyE')) {
      this.playerInteract = { type: null, t: 0, total: 0 };
      return;
    }
    if (this.playerInteract.type) return; // 已在装/拆中
    if (p.team === 'T' && p.hasBomb && !this.bomb.planted) {
      const site = this.nearbySite(p.move.pos);
      if (site) {
        this.playerInteract = { type: 'plant', t: 0, total: MATCH.plantTime };
        sfx.play('plant');
      }
    } else if (p.team === 'CT' && this.bomb.planted && p.move.pos.distanceTo(this.bomb.pos) < 130) {
      this.playerInteract = { type: 'defuse', t: 0, total: p.hasKit ? MATCH.kitDefuseTime : MATCH.defuseTime };
      sfx.play('defuse');
    }
  }

  private updateBomb(dt: number) {
    const p = this.player;
    // 玩家装/拆进度
    if (this.playerInteract.type === 'plant') {
      if (p.alive && p.hasBomb && !this.bomb.planted && this.input.keys.has('KeyE') && this.nearbySite(p.move.pos)) {
        this.playerInteract.t += dt;
        if (this.playerInteract.t >= this.playerInteract.total) this.doPlant(p);
      } else {
        this.playerInteract = { type: null, t: 0, total: 0 };
      }
    } else if (this.playerInteract.type === 'defuse') {
      if (p.alive && this.bomb.planted && this.input.keys.has('KeyE') && p.move.pos.distanceTo(this.bomb.pos) < 130) {
        this.playerInteract.t += dt;
        if (this.playerInteract.t >= this.playerInteract.total) this.doDefuse();
      } else {
        this.playerInteract = { type: null, t: 0, total: 0 };
      }
    }

    if (this.bomb.planted) {
      this.bomb.time -= dt;
      // 越来越快的滴滴声
      const interval = Math.max(0.25, 1 + this.bomb.time / 30);
      this.bomb.beepT -= dt;
      if (this.bomb.beepT <= 0) {
        this.bomb.beepT = interval;
        sfx.play('bomb_beep');
        this.bombAlert = Math.max(this.bombAlert, 0.3);
      }
      if (this.bomb.time <= 0) {
        this.explodeBomb();
      }
    }
  }

  private doPlant(planter: Combatant) {
    const site = this.nearbySite(planter.move.pos);
    if (!site) return;
    this.bomb.planted = true;
    this.bomb.pos.copy(site.pos);
    this.bomb.pos.y = 0;
    this.bomb.time = MATCH.bombTime;
    this.bomb.beepT = 0;
    this.bomb.mesh.position.copy(this.bomb.pos);
    this.bomb.mesh.visible = true;
    this.playerInteract = { type: null, t: 0, total: 0 };
    planter.hasBomb = false;
    if (planter.isPlayer) this.player.money += MATCH.plantReward;
    else planter.money += MATCH.plantReward;
    this.addKillFeed('炸弹', '已被安装', 'T');
  }

  private doDefuse() {
    this.bomb.planted = false;
    this.bomb.mesh.visible = false;
    this.playerInteract = { type: null, t: 0, total: 0 };
    const defuser = this.bots.find((b) => b.actions.defuse);
    if (defuser) defuser.money += MATCH.defuseReward;
    else this.player.money += MATCH.defuseReward;
    this.addKillFeed('CT', '拆除了炸弹', 'CT');
  }

  private explodeBomb() {
    this.bomb.planted = false;
    this.bomb.mesh.visible = false;
    sfx.play('bomb_explode');
    this.explosionFlash = 1;
    // 范围伤害
    const r = MATCH.bombRadius;
    const all: Combatant[] = [this.player, ...this.bots];
    for (const e of all) {
      if (!e.alive) continue;
      const d = e.move.pos.distanceTo(this.bomb.pos);
      if (d < r) {
        const dmg = Math.round((1 - d / r) * 150 + 30);
        if (e.isPlayer) this.player.applyDamage(dmg);
        else e.applyDamage(dmg);
      }
    }
    this.endRound('T', 'bomb_explode');
  }

  private nearbySite(pos: THREE.Vector3): MapSite | null {
    for (const s of this.map.sites) {
      const d = Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z);
      if (d < s.radius) return s;
    }
    return null;
  }

  private checkWinCondition() {
    if (this.phase !== 'live') return;
    const tAlive = this.bots.filter((b) => b.team === 'T' && b.alive).length + (this.player.team === 'T' && this.player.alive ? 1 : 0);
    const ctAlive = this.bots.filter((b) => b.team === 'CT' && b.alive).length + (this.player.team === 'CT' && this.player.alive ? 1 : 0);
    if (!this.bomb.planted) {
      if (tAlive <= 0) return this.endRound('CT', 'elimination');
      if (ctAlive <= 0) return this.endRound('T', 'elimination');
      if (this.roundT <= 0) return this.endRound('CT', 'timeout');
    } else {
      // 包已安：敌方全灭立即结束；T 全灭则等爆炸/拆包（CS:GO 规则）
      if (ctAlive <= 0) return this.endRound('T', 'elimination');
      if (tAlive <= 0) return;
      if (this.roundT <= 0) return;
    }
  }

  // ============================================================
  // 特效
  // ============================================================

  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3) {
    const mat = new THREE.LineBasicMaterial({
      color: 0xfff2c0,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09 });
  }

  private spawnBlood(point: THREE.Vector3) {
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 2),
        new THREE.MeshBasicMaterial({ color: 0xcc2222 }),
      );
      mesh.position.copy(point);
      this.scene.add(mesh);
      this.bloods.push({
        mesh,
        vel: new THREE.Vector3((Math.random() - 0.5) * 120, 60 + Math.random() * 120, (Math.random() - 0.5) * 120),
        life: 0.55 + Math.random() * 0.3,
      });
    }
  }

  private spawnImpact(point: THREE.Vector3, _kind: number) {
    // 火花
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1.5, 1.5),
        new THREE.MeshBasicMaterial({ color: 0xffcc66 }),
      );
      mesh.position.copy(point);
      this.scene.add(mesh);
      this.bloods.push({
        mesh,
        vel: new THREE.Vector3((Math.random() - 0.5) * 100, 30 + Math.random() * 90, (Math.random() - 0.5) * 100),
        life: 0.3,
      });
    }
  }

  private updateEffects(dt: number) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.09) * 0.7;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.bloods.length - 1; i >= 0; i--) {
      const b = this.bloods[i];
      b.life -= dt;
      b.vel.y -= 500 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.bloods.splice(i, 1);
      }
    }
    this.hitmarkerT = Math.max(0, this.hitmarkerT - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
    this.bombAlert = Math.max(0, this.bombAlert - dt);
    this.explosionFlash = Math.max(0, this.explosionFlash - dt * 0.6);
  }

  // ============================================================
  // 投掷物
  // ============================================================

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const det = this.projectiles[i].update(dt, this.map.brushes);
      if (det) {
        this.projectiles.splice(i, 1);
        this.applyDetonation(det);
      }
    }
  }

  private applyDetonation(det: Detonation) {
    const pos = det.pos;
    const shooter = this.findCombatant(det.owner);
    if (det.type === 'he') {
      sfx.play('nade_explode');
      this.spawnExplosion(pos, 0xff9a30);
      this.noiseEvents.push({ pos: pos.clone(), radius: 3200 });
      const radius = NADES.he.radius;
      for (const t of this.allCombatants()) {
        if (!t.alive) continue;
        const d = t.move.pos.distanceTo(pos);
        if (d > radius) continue;
        const chest = new THREE.Vector3(t.move.pos.x, t.move.pos.y + 50, t.move.pos.z);
        const dir = chest.clone().sub(pos).normalize();
        const hit = MovementController.raycastBrushes(this.map.brushes, pos, dir, d);
        if (hit < d - 20) continue; // 墙挡住
        const dmg = Math.round(94 * Math.max(0.15, 1 - d / radius));
        this.dealDamage(t, Math.max(1, dmg), shooter ?? this.player, false, chest);
      }
    } else if (det.type === 'flash') {
      sfx.play('flash_pop');
      this.spawnExplosion(pos, 0xfff6c8);
      const radius = NADES.flash.radius;
      for (const t of this.allCombatants()) {
        if (!t.alive) continue;
        const d = t.move.pos.distanceTo(pos);
        if (d > radius) continue;
        const eye = new THREE.Vector3(t.move.pos.x, t.move.pos.y + 60, t.move.pos.z);
        const dir = eye.clone().sub(pos).normalize();
        const hit = MovementController.raycastBrushes(this.map.brushes, pos, dir, d);
        if (hit < d - 20) continue;
        const strength = Math.max(0, 1 - d / radius);
        if (t.isPlayer) this.flashOverlay = Math.max(this.flashOverlay, strength);
        else (t as Bot).blindT = Math.max((t as Bot).blindT, strength * 2.6);
      }
    } else if (det.type === 'smoke') {
      sfx.play('smoke_pop');
      this.spawnSmoke(pos);
      this.noiseEvents.push({ pos: pos.clone(), radius: 1000 });
    } else if (det.type === 'molotov') {
      sfx.play('fire');
      this.spawnFire(pos, det.owner);
      this.noiseEvents.push({ pos: pos.clone(), radius: 1400 });
    }
  }

  private allCombatants(): Array<PlayerController | Bot> {
    return [this.player, ...this.bots];
  }

  private findCombatant(name: string): PlayerController | Bot | null {
    if (this.player.name === name) return this.player;
    return this.bots.find((b) => b.name === name) ?? null;
  }

  private spawnExplosion(pos: THREE.Vector3, color: number) {
    const geo = new THREE.SphereGeometry(NADES.he.radius * 0.22, 12, 10);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const light = new THREE.PointLight(color, 3, 700, 2);
    light.position.copy(pos);
    this.scene.add(light);
    this.effects.push({ mesh, t: 0, max: 0.38, light });
  }

  private spawnSmoke(pos: THREE.Vector3) {
    const radius = NADES.smoke.radius;
    const geo = new THREE.SphereGeometry(radius * 0.52, 14, 12);
    const mat = new THREE.MeshLambertMaterial({ color: 0x9b9b9b, transparent: true, opacity: 0.38, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, 62, pos.z);
    this.scene.add(mesh);
    this.smokes.push({ pos: new THREE.Vector3(pos.x, 62, pos.z), radius, t: 16, mesh });
  }

  private spawnFire(pos: THREE.Vector3, owner: string) {
    const radius = NADES.molotov.radius;
    const geo = new THREE.CylinderGeometry(radius * 0.55, radius * 0.72, 10, 24, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff6a00, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, 4, pos.z);
    this.scene.add(mesh);
    const light = new THREE.PointLight(0xff7a20, 1.3, 520, 2);
    light.position.set(pos.x, 60, pos.z);
    this.scene.add(light);
    this.fires.push({ pos: pos.clone(), radius, t: 5, mesh, tickT: 0, light, owner });
  }

  private updateSmokes(dt: number) {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t -= dt;
      const mat = s.mesh.material as THREE.MeshLambertMaterial;
      if (s.t < 3) mat.opacity = Math.max(0, s.t / 3) * 0.38;
      if (s.t <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        mat.dispose();
        this.smokes.splice(i, 1);
      }
    }
  }

  private updateFires(dt: number) {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      f.tickT -= dt;
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.random() * 0.25;
      f.light.intensity = 0.9 + Math.random() * 0.7;
      if (f.tickT <= 0) {
        f.tickT = 0.25;
        const shooter = this.findCombatant(f.owner);
        for (const t of this.allCombatants()) {
          if (!t.alive) continue;
          const d = t.move.pos.distanceTo(f.pos);
          if (d < f.radius * 0.55) {
            this.dealDamage(t, 22, shooter ?? this.player, false, new THREE.Vector3(t.move.pos.x, t.move.pos.y + 30, t.move.pos.z));
          }
        }
      }
      if (f.t <= 0) {
        this.scene.remove(f.mesh);
        this.scene.remove(f.light);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.fires.splice(i, 1);
      }
    }
  }

  private updateVisionOverlays(dt: number) {
    this.flashOverlay = Math.max(0, this.flashOverlay - dt * 0.42);
    this.el.flashOverlay.style.opacity = String(Math.min(1, this.flashOverlay * 1.2));
    let smoke = 0;
    const cam = this.player.camera.position;
    for (const s of this.smokes) {
      const d = cam.distanceTo(s.pos);
      if (d < s.radius) smoke = Math.max(smoke, 1 - d / s.radius);
    }
    this.el.smokeOverlay.style.opacity = String(Math.min(0.65, smoke * 0.85));
  }

  private cycleNade() {
    const p = this.player;
    const owned = NADE_TYPES.filter((t) => p.nades[t] > 0);
    if (!owned.length) {
      this.buyToast('没有投掷物，开局按 B 购买');
      return;
    }
    if (!this.nadeSelect) this.prevSlot = p.currentSlot;
    const i = owned.indexOf(this.nadeSelect ?? owned[owned.length - 1]);
    this.nadeSelect = owned[(i + 1) % owned.length];
    this.nadeCookT = 0;
    sfx.play('nade_pull');
  }

  private deselectNade() {
    if (this.nadeSelect) {
      this.nadeSelect = null;
      this.nadeCookT = 0;
    }
  }

  private updateNades(dt: number) {
    const p = this.player;
    if (this.nadeSelect && p.alive && this.phase === 'live') {
      if (this.input.fire) this.nadeCookT = Math.min(1.6, this.nadeCookT + dt);
      if (this.prevFire && !this.input.fire && this.nadeCookT > 0) {
        this.throwNade(this.nadeSelect, this.nadeCookT);
      }
    }
    this.prevFire = this.input.fire;
  }

  private throwNade(type: NadeType, cook: number) {
    const p = this.player;
    if (p.nades[type] <= 0) {
      this.deselectNade();
      return;
    }
    p.nades[type]--;
    const dir = new THREE.Vector3();
    p.camera.getWorldDirection(dir);
    this.projectiles.push(new NadeProjectile(type, p.team, p.name, p.eyePosition, dir, p.move.vel, cook));
    sfx.play('nade_throw');
    this.noiseEvents.push({ pos: p.move.pos.clone(), radius: 1400 });
    this.nadeCookT = 0;
    this.deselectNade();
    p.switchSlot(this.prevSlot);
  }

  // ============================================================
  // 小地图
  // ============================================================

  private buildMinimap() {
    const cw = 240;
    const ch = Math.max(120, Math.round((240 * this.map.def.h) / this.map.def.w));
    this.minimap.width = cw;
    this.minimap.height = ch;
    const st = document.createElement('canvas');
    st.width = cw;
    st.height = ch;
    const sctx = st.getContext('2d')!;
    const nav = this.map.nav;
    const cw_ = cw / nav.w;
    const ch_ = ch / nav.h;
    sctx.fillStyle = '#131a22';
    sctx.fillRect(0, 0, cw, ch);
    for (let z = 0; z < nav.h; z++) {
      for (let x = 0; x < nav.w; x++) {
        if (!nav.isWalkable(x, z)) {
          sctx.fillStyle = '#3a4452';
          sctx.fillRect(x * cw_, z * ch_, cw_ + 0.5, ch_ + 0.5);
        }
      }
    }
    // 包点
    for (const s of this.map.sites) {
      const [x, y] = this.worldToMini(s.pos, cw, ch);
      sctx.fillStyle = s.id === 'A' ? '#4caf50' : '#f2c14e';
      sctx.fillRect(x - 6, y - 6, 12, 12);
    }
    // 出生点
    for (const sp of this.map.spawns.t) {
      const [x, y] = this.worldToMini(sp, cw, ch);
      sctx.fillStyle = '#c9a24b';
      sctx.beginPath();
      sctx.arc(x, y, 3, 0, Math.PI * 2);
      sctx.fill();
    }
    for (const sp of this.map.spawns.ct) {
      const [x, y] = this.worldToMini(sp, cw, ch);
      sctx.fillStyle = '#4a9be0';
      sctx.beginPath();
      sctx.arc(x, y, 3, 0, Math.PI * 2);
      sctx.fill();
    }
    this.minimapStatic = st;
  }

  private worldToMini(p: THREE.Vector3, cw = this.minimap.width, ch = this.minimap.height): [number, number] {
    const w = this.map.def.w * this.map.def.tile;
    const h = this.map.def.h * this.map.def.tile;
    return [(p.x / w + 0.5) * cw, (p.z / h + 0.5) * ch];
  }

  private drawMinimap() {
    const ctx = this.minimapCtx;
    const cw = this.minimap.width;
    const ch = this.minimap.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(this.minimapStatic, 0, 0);
    const p = this.player;
    // 队友
    for (const b of this.bots) {
      if (!b.alive || b.team !== p.team) continue;
      const [x, y] = this.worldToMini(b.move.pos);
      ctx.fillStyle = b.team === 'T' ? '#e0b44a' : '#4a9be0';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // 炸弹（已安装/掉落）
    const bombPos = this.bomb.planted ? this.bomb.pos : this.bomb.dropped;
    if (bombPos) {
      const [x, y] = this.worldToMini(bombPos);
      ctx.fillStyle = '#ff4d4f';
      ctx.beginPath();
      ctx.arc(x, y, 3.5 + Math.sin(performance.now() / 180) * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // 玩家箭头
    if (p.alive) {
      const [x, y] = this.worldToMini(p.move.pos);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.yaw);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ============================================================
  // HUD
  // ============================================================

  private buildHud() {
    const root = document.createElement('div');
    root.id = 'game-hud';
    root.innerHTML = `
      <div id="topbar">
        <div id="round-info">第 1 回合</div>
        <div id="score"><span class="ct">CT 0</span><span class="sep">:</span><span class="t">0 T</span></div>
        <div id="timer">1:55</div>
        <div id="bomb-status"></div>
      </div>
      <div id="team-status"></div>
      <div id="killfeed"></div>
      <div id="scope-overlay">
        <div class="scope-h"></div>
        <div class="scope-v"></div>
      </div>
      <div id="crosshair">
        <div class="ch l"></div><div class="ch r"></div><div class="ch u"></div><div class="ch d"></div><div class="ch dot"></div>
      </div>
      <div id="bottom-left">
        <div id="health">100</div>
        <div id="armor">100</div>
        <div id="money">$800</div>
        <div id="bomb-icon" class="hidden">● 炸弹</div>
      </div>
      <div id="bottom-right">
        <div id="ammo">12 / 24</div>
        <div id="weapon-name">USP</div>
      </div>
      <div id="nade-hud"></div>
      <div id="nade-cook"><div id="nade-cook-bar"></div></div>
      <div id="buy-toast"></div>
      <div id="interact-hint"></div>
      <div id="progress"><div id="progress-bar"></div></div>
      <canvas id="minimap"></canvas>
      <div id="flash-overlay"></div>
      <div id="smoke-overlay"></div>
      <div id="banner"><div id="banner-title"></div><div id="banner-sub"></div></div>
      <div id="damage-vignette"></div>
      <div id="hitmarker"></div>
      <div id="buy-menu">
        <div id="buy-title">购买装备</div>
        <div id="buy-tip">点击或按数字键购买 · 购买后自动关闭</div>
        <div id="buy-items"></div>
        <div id="buy-money"></div>
      </div>
      <div id="scoreboard">
        <div id="scoreboard-title">计分板</div>
        <div id="scoreboard-body"></div>
      </div>
      <div id="death-overlay">你已阵亡<br/><small>正在观战队友 · 点击鼠标切换队友视角</small></div>
      <div id="pause-overlay">
        <h2>已暂停</h2>
        <button id="resume-btn">继续游戏</button>
        <button id="restart-btn" style="display:none">再来一局</button>
        <button id="quit-btn">返回主菜单</button>
      </div>
    `;
    document.body.appendChild(root);
    this.hud = root;
    const $ = (id: string) => root.querySelector<HTMLDivElement>(id)!;
    this.el.timer = $('#timer');
    this.el.score = $('#score');
    this.el.round = $('#round-info');
    this.el.health = $('#health');
    this.el.armor = $('#armor');
    this.el.money = $('#money');
    this.el.ammo = $('#ammo');
    this.el.weaponName = $('#weapon-name');
    this.el.nadeHud = $('#nade-hud');
    this.el.nadeCook = $('#nade-cook');
    this.el.nadeCookBar = $('#nade-cook-bar');
    this.el.flashOverlay = $('#flash-overlay');
    this.el.smokeOverlay = $('#smoke-overlay');
    this.minimap = $('#minimap') as unknown as HTMLCanvasElement;
    this.minimapCtx = this.minimap.getContext('2d')!;
    this.buildMinimap();
    this.el.buyToast = $('#buy-toast');
    this.el.teamStatus = $('#team-status');
    this.el.scope = $('#scope-overlay');
    this.el.bombStatus = $('#bomb-status');
    this.el.killfeed = $('#killfeed');
    this.el.interact = $('#interact-hint');
    this.el.progress = $('#progress');
    this.el.progressBar = $('#progress-bar');
    this.el.banner = $('#banner');
    this.el.damage = $('#damage-vignette');
    this.el.hitmarker = $('#hitmarker');
    this.el.buyMenu = $('#buy-menu');
    this.el.buyItems = $('#buy-items');
    this.el.buyMoney = $('#buy-money');
    this.el.scoreboard = $('#scoreboard');
    this.el.scoreboardTitle = $('#scoreboard-title');
    this.el.scoreboardBody = $('#scoreboard-body');
    this.el.death = $('#death-overlay');
    this.el.pause = $('#pause-overlay');
    this.el.bombIcon = $('#bomb-icon');
    this.el.banner.querySelector('#banner-title')!.id = 'banner-title';
    this.el.banner.querySelector('#banner-sub')!.id = 'banner-sub';
    $('#resume-btn').addEventListener('click', () => this.togglePause());
    $('#restart-btn').addEventListener('click', () => this.restart());
    $('#quit-btn').addEventListener('click', () => this.quit());
    this.el.buyMenu.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-buy]');
      if (btn) this.buyItem(btn.dataset.buy!);
    });
  }

  private updateHud(dt: number) {
    const p = this.player;
    const t = Math.max(0, Math.ceil(this.bomb.planted ? this.bomb.time : this.roundT));
    this.el.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.el.score.innerHTML = `<span class="ct">CT ${this.score.ct}</span><span class="sep">:</span><span class="t">${this.score.t} T</span>`;
    this.el.round.textContent = `第 ${this.round} 回合`;
    this.el.health.textContent = String(Math.max(0, Math.ceil(p.health)));
    this.el.armor.textContent = String(Math.max(0, Math.ceil(p.armor)));
    this.el.money.textContent = '$' + p.money;
    const w = p.weapon;
    if (this.nadeSelect) {
      const nd = NADES[this.nadeSelect];
      this.el.ammo.textContent = `×${p.nades[this.nadeSelect]}`;
      this.el.weaponName.textContent = `${nd.name} · 按住左键蓄力，松手投掷`;
    } else {
      this.el.ammo.textContent = w.isKnife ? '∞' : `${w.ammoInMag} / ${w.reserve}`;
      this.el.weaponName.textContent = w.def.name;
    }
    // 投掷物计数
    this.el.nadeHud.textContent =
      `G 投掷物｜高爆×${p.nades.he} 闪光×${p.nades.flash} 烟×${p.nades.smoke} 火×${p.nades.molotov}`;
    // 蓄力条
    const cooking = !!this.nadeSelect && this.input.fire;
    this.el.nadeCook.style.display = cooking ? 'block' : 'none';
    if (cooking) {
      this.el.nadeCookBar.style.width = `${Math.min(100, (this.nadeCookT / 1.6) * 100)}%`;
    }
    this.el.bombIcon.classList.toggle('hidden', !p.hasBomb);

    // 双方存活状态（顶部）
    const tAlive = this.bots.filter((b) => b.team === 'T' && b.alive).length + (p.team === 'T' && p.alive ? 1 : 0);
    const ctAlive = this.bots.filter((b) => b.team === 'CT' && b.alive).length + (p.team === 'CT' && p.alive ? 1 : 0);
    const dots = (alive: number) => {
      let s = '';
      for (let i = 0; i < 5; i++) s += `<span class="dot ${i < alive ? 'alive' : ''}"></span>`;
      return s;
    };
    this.el.teamStatus.innerHTML =
      `<span class="ts-t">T <span class="tdots">${dots(tAlive)}</span> ${tAlive}/5</span>` +
      `<span class="ts-ct">CT <span class="tdots">${dots(ctAlive)}</span> ${ctAlive}/5</span>`;

    // 瞄准镜（AWP 开镜时显示镜圈并隐藏准星）
    const scoped = w.def.id === 'awp' && w.scoped;
    this.el.scope.style.display = scoped ? 'block' : 'none';
    const ch = this.hud.querySelector('#crosshair') as HTMLElement;
    ch.style.display = scoped ? 'none' : 'block';

    // 购买提示淡出
    if (this.buyToastT > 0) {
      this.buyToastT -= dt;
      if (this.buyToastT <= 0) this.el.buyToast.style.opacity = '0';
    }

    // 炸弹状态
    if (this.bomb.planted) {
      this.el.bombStatus.textContent = `💣 ${Math.ceil(this.bomb.time)}s`;
      this.el.bombStatus.classList.add('planted');
    } else {
      this.el.bombStatus.textContent = '';
      this.el.bombStatus.classList.remove('planted');
    }

    // 互动提示
    let hint = '';
    let progress: { t: number; total: number } | null = null;
    if (p.alive && this.phase === 'live') {
      if (p.team === 'T' && p.hasBomb && !this.bomb.planted && this.nearbySite(p.move.pos)) {
        hint = '按住 E 安装炸弹';
      } else if (p.team === 'CT' && this.bomb.planted && p.move.pos.distanceTo(this.bomb.pos) < 130) {
        hint = '按住 E 拆除炸弹';
      } else if (this.bomb.dropped && p.team === 'T' && !p.hasBomb && p.move.pos.distanceTo(this.bomb.dropped) < 90) {
        hint = '按 E 拾取炸弹';
      }
      if (this.playerInteract.type) progress = this.playerInteract;
    }
    this.el.interact.textContent = hint;
    this.el.interact.style.display = hint ? 'block' : 'none';
    if (progress) {
      this.el.progress.style.display = 'block';
      this.el.progressBar.style.width = `${Math.min(100, (progress.t / progress.total) * 100)}%`;
    } else {
      this.el.progress.style.display = 'none';
    }

    this.el.damage.style.opacity = String(this.damageFlash * 0.8);
    this.el.hitmarker.style.opacity = this.hitmarkerT > 0 ? '1' : '0';
    if (this.explosionFlash > 0.5) {
      this.el.damage.style.opacity = String(this.explosionFlash * 0.9);
    }

    // 购买菜单
    const inBuyWindow = this.phase === 'freeze' || (this.phase === 'live' && this.roundT > MATCH.roundTime - MATCH.buyTime);
    if (inBuyWindow && this.buyAuto) {
      if (!this.buyOpen && this.player.alive) this.showBuyMenu();
    } else if (this.buyOpen) {
      this.closeBuyMenu();
    }

    // 记分板
    this.el.scoreboard.style.display = this.input.scoreboard ? 'flex' : 'none';
    if (this.input.scoreboard) this.renderScoreboard();

    // 击杀播报清理
    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      this.killFeed[i].t -= dt;
      if (this.killFeed[i].t <= 0) {
        this.killFeed[i].el.remove();
        this.killFeed.splice(i, 1);
      }
    }
  }

  private buyOpen = false;
  private buyAuto = true; // 回合开始自动打开购买菜单；手动关闭后不再自动弹
  private buyList: Array<{ id: string; name: string; price: number }> = [];
  private buyToastT = 0;

  private showBuyMenu() {
    if (this.buyOpen) return;
    this.buyOpen = true;
    // 打开购买菜单时释放鼠标锁定，方便用鼠标点
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch {
        /* 忽略 */
      }
    }
    const p = this.player;
    const items = [
      { id: 'usp', name: 'USP 手枪', price: 0, desc: '默认副武器' },
      ...(p.team === 'T' ? [{ id: 'ak', name: 'AK-47', price: 2700, desc: 'T 方步枪' }] : []),
      ...(p.team === 'CT' ? [{ id: 'm4', name: 'M4A4', price: 3100, desc: 'CT 方步枪' }] : []),
      { id: 'awp', name: 'AWP', price: 4750, desc: '重型狙击' },
      { id: 'armor', name: '防弹衣+头盔', price: 1000, desc: '降低所受伤害' },
      ...(p.team === 'CT' ? [{ id: 'kit', name: '拆弹钳', price: 400, desc: '拆弹时间减半' }] : []),
      { id: 'he', name: '高爆手雷', price: 300, desc: '范围伤害' },
      { id: 'flash', name: '闪光弹', price: 200, desc: '致盲敌人' },
      { id: 'smoke', name: '烟雾弹', price: 300, desc: '遮挡视线' },
      { id: 'molotov', name: '燃烧瓶', price: 400, desc: '封锁区域' },
    ];
    this.buyList = items;
    const money = p.money;
    this.el.buyItems.innerHTML = items
      .map((it, i) => {
        const nadeDef = NADES[it.id as NadeType];
        const ownedFull = nadeDef ? p.nades[it.id as NadeType] >= nadeDef.max : false;
        const disabled = it.price > money || ownedFull;
        return `
        <div class="buy-item ${disabled ? 'disabled' : ''}" data-buy="${it.id}">
          <div class="buy-name"><span class="buy-key">${i + 1}</span>${it.name}</div>
          <div class="buy-desc">${it.desc}</div>
          <div class="buy-price">${it.price === 0 ? '免费' : '$' + it.price}${it.price > money ? ' <span class="lack">余额不足</span>' : ownedFull ? ' <span class="lack">已带满</span>' : ''}</div>
        </div>`;
      })
      .join('');
    this.el.buyMenu.style.display = 'flex';
    this.el.buyMoney.textContent = '余额 $' + p.money;
  }

  private closeBuyMenu() {
    this.buyOpen = false;
    this.el.buyMenu.style.display = 'none';
    this.input.fire = false;
    this.input.rmb = false;
  }

  private toggleBuyMenu() {
    if (this.buyOpen) {
      this.buyAuto = false; // 手动关闭后不再自动弹
      this.closeBuyMenu();
    } else if (this.player.alive) {
      this.buyAuto = true; // 手动重开，保持打开状态
      this.showBuyMenu();
    }
  }

  private buyItem(id: string) {
    const p = this.player;
    if (id === 'usp') return;
    if (id === 'armor') {
      if (p.money >= 1000 && p.armor < 100) {
        p.armor = 100;
        p.money -= 1000;
        sfx.play('buy');
        this.buyToast('已购买 防弹衣+头盔');
        this.buyAuto = false;
        this.closeBuyMenu();
      } else {
        this.buyToast(p.money < 1000 ? '余额不足，需要 $1000' : '已有护甲');
      }
      return;
    }
    if (id === 'kit') {
      if (p.money >= 400 && !p.hasKit && p.team === 'CT') {
        p.hasKit = true;
        p.money -= 400;
        sfx.play('buy');
        this.buyToast('已购买 拆弹钳');
        this.buyAuto = false;
        this.closeBuyMenu();
      } else {
        this.buyToast(p.money < 400 ? '余额不足，需要 $400' : '已有拆弹钳');
      }
      return;
    }
    const nadeDef = NADES[id as NadeType];
    if (nadeDef) {
      const key = id as NadeType;
      if (p.nades[key] >= nadeDef.max) {
        this.buyToast('该投掷物已带满');
        return;
      }
      if (p.money < nadeDef.price) {
        this.buyToast(`余额不足，需要 $${nadeDef.price}`);
        return;
      }
      p.money -= nadeDef.price;
      p.nades[key]++;
      sfx.play('buy');
      this.buyToast(`已购买 ${nadeDef.name}`);
      this.buyAuto = false;
      this.closeBuyMenu();
      return;
    }
    const def = WEAPONS[id];
    if (!def) return;
    if (def.team !== 'both' && def.team !== p.team) return;
    if (p.weapons.has(id)) {
      this.buyToast('已拥有该武器');
      return;
    }
    if (p.money < def.price) {
      this.buyToast(`余额不足，需要 $${def.price}`);
      return;
    }
    p.buyWeapon(id);
    this.el.buyMoney.textContent = '余额 $' + p.money;
    this.buyToast(`已购买 ${def.name}`);
    this.buyAuto = false;
    this.closeBuyMenu();
  }

  private buyToast(text: string) {
    this.el.buyToast.textContent = text;
    this.buyToastT = 1.3;
    this.el.buyToast.style.opacity = '1';
  }

  private renderScoreboard() {
    const rows: Combatant[] = [this.player, ...this.bots];
    const sorted = [...rows].sort((a, b) => b.kills - a.kills);
    this.el.scoreboardBody.innerHTML = sorted
      .map(
        (e) => `
        <div class="sb-row ${e.team}">
          <span class="sb-name">${e.isPlayer ? '★ ' : ''}${e.name}</span>
          <span>${e.kills}</span><span>${e.deaths}</span><span>$${e.money}</span>
        </div>`,
      )
      .join('');
  }

  private addKillFeed(killer: string, victim: string, team: Team) {
    const el = document.createElement('div');
    el.className = `kf-entry ${team}`;
    el.textContent = `${killer} 击杀 ${victim}`;
    this.el.killfeed.appendChild(el);
    this.killFeed.push({ el, t: 4 });
    while (this.killFeed.length > 5) {
      const old = this.killFeed.shift()!;
      old.el.remove();
    }
  }

  private banner(title: string, sub: string) {
    const t = this.hud.querySelector('#banner-title')!;
    const s = this.hud.querySelector('#banner-sub')!;
    t.textContent = title;
    s.textContent = sub;
    this.el.banner.style.display = title ? 'flex' : 'none';
  }

  // ============================================================
  // 事件
  // ============================================================

  private bindEvents(canvas: HTMLCanvasElement) {
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('click', this.onCanvasClick);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('resize', this.onResize);
  }

  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.renderer.domElement) return;
    this.input.mouseDX += e.movementX;
    this.input.mouseDY += e.movementY;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.player.alive) {
      if (e.button === 0) this.cycleSpectate();
      return;
    }
    if (e.button === 0) this.input.fire = true;
    if (e.button === 2) this.input.rmb = true;
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.input.fire = false;
    if (e.button === 2) this.input.rmb = false;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Tab') {
      e.preventDefault();
      this.input.scoreboard = true;
    }
    this.input.keys.add(e.code);
    if (e.repeat) return;
    if (this.buyOpen && e.code.startsWith('Digit')) {
      const idx = parseInt(e.code.slice(5), 10) - 1;
      const item = this.buyList[idx];
      if (item) this.buyItem(item.id);
      return;
    }
    if (e.code === 'KeyE') this.input.interact = true;
    if (e.code === 'KeyR') this.input.reload = true;
    if (e.code === 'KeyB') this.input.buy = true;
    if (e.code === 'KeyG') this.cycleNade();
    if (e.code === 'Digit1') { this.input.slot = 1; this.deselectNade(); }
    if (e.code === 'Digit2') { this.input.slot = 2; this.deselectNade(); }
    if (e.code === 'Digit3') { this.input.slot = 3; this.deselectNade(); }
    if (e.code === 'KeyM') sfx.setMuted(!sfx.muted);
    if (e.code === 'Escape' && performance.now() - this.lastLockExit > 200) {
      this.togglePause();
      if (document.pointerLockElement) {
        try {
          document.exitPointerLock();
        } catch {
          /* 忽略 */
        }
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.input.keys.delete(e.code);
    if (e.code === 'Tab') this.input.scoreboard = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.input.wheel += e.deltaY > 0 ? 1 : -1;
    this.deselectNade();
  };

  private onCanvasClick = () => {
    if (!document.pointerLockElement && !this.paused && this.phase !== 'matchover') {
      try {
        this.renderer.domElement.requestPointerLock();
      } catch {
        // 无头/不支持的环境忽略
      }
    }
  };

  private onLockChange = () => {
    if (!document.pointerLockElement && !this.paused && !this.buyOpen && this.phase !== 'matchover') {
      this.lastLockExit = performance.now();
      this.paused = true;
      this.el.pause.style.display = 'flex';
    }
  };

  private onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.player.camera.aspect = window.innerWidth / window.innerHeight;
    this.player.camera.updateProjectionMatrix();
  };

  private togglePause() {
    if (this.phase === 'matchover') return;
    this.paused = !this.paused;
    this.el.pause.style.display = this.paused ? 'flex' : 'none';
    const h2 = this.el.pause.querySelector('h2');
    if (h2) h2.textContent = '已暂停';
    const restart = this.hud.querySelector<HTMLElement>('#restart-btn')!;
    restart.style.display = 'none';
    const resume = this.hud.querySelector<HTMLElement>('#resume-btn')!;
    resume.style.display = 'block';
    if (!this.paused) {
      try {
        this.renderer.domElement.requestPointerLock();
      } catch {
        // 忽略
      }
      this.clock.getDelta();
    }
  }

  private restart() {
    this.dispose();
    this.onRestart();
  }

  private quit() {
    this.dispose();
    this.onQuit();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('resize', this.onResize);
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.remove();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.renderer.dispose();
  }
}

function reasonText(r: string): string {
  switch (r) {
    case 'elimination': return '全歼对手';
    case 'timeout': return '时间耗尽';
    case 'bomb_explode': return '炸弹引爆';
    default: return '';
  }
}
