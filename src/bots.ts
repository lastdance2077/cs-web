import * as THREE from 'three';
import { FEEL, MATCH, WEAPONS, type BotDifficulty, type Team } from './config';
import { MovementController, type Brush } from './movement';
import { createBotModel, poseArm, type BotModel } from './models';
import { WeaponSystem } from './weapons';
import type { CompiledMap, MapSite } from './maps';
import { sfx } from './audio';
import { NADES, type NadeType } from './throwables';

export interface EnemyRef {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  alive: boolean;
  isPlayer: boolean;
}

export interface NoiseEvent {
  pos: THREE.Vector3;
  radius: number;
  team: Team; // 声音来源阵营：人机只调查敌方动静
}

export interface BotWorld {
  map: CompiledMap;
  brushes: Brush[];
  bombPlanted: boolean;
  bombPos: THREE.Vector3;
  bombTimeLeft: number;
  bombDropped: THREE.Vector3 | null;
  noises: NoiseEvent[];
  smokes: Array<{ pos: THREE.Vector3; radius: number }>;
  time: number;
}

export interface BotActions {
  plant: boolean;
  plantProgress: number;
  defuse: boolean;
  defuseProgress: number;
  shot: { origin: THREE.Vector3; dir: THREE.Vector3 } | null;
  nade: { type: NadeType; dir: THREE.Vector3; cook: number } | null;
}

export class Bot {
  name: string;
  team: Team;
  diff: BotDifficulty;
  isPlayer = false;
  move: MovementController;
  model: BotModel;
  weapons = new Map<string, WeaponSystem>();
  currentSlot: 'primary' | 'secondary' | 'melee' = 'secondary';
  private currentId = 'usp';

  health = 100;
  armor = 0;
  money = 4000;
  nades: Record<NadeType, number> = { he: 0, flash: 0, smoke: 0, molotov: 0 };
  alive = true;
  hasBomb = false;
  hasKit = false;
  kills = 0;
  deaths = 0;
  frozen = false; // 调试用：冻结 AI（测试靶子）
  lockMove = false; // 冻结期锁移动

  state: 'idle' | 'advance' | 'combat' | 'plant' | 'defuse' | 'dead' = 'idle';
  role: 'siteA' | 'siteB' | 'mid' | 'bomb' = 'siteA';
  siteChoice: 'A' | 'B' = 'A';
  private path: THREE.Vector3[] = [];
  private pathIdx = 0;
  private repathT = 0;
  private aimYaw = 0;
  private aimPitch = 0;
  private target: EnemyRef | null = null;
  private reactionT = 0;
  private burstLeft = 0;
  private burstT = 0;
  private strafeDir = 1;
  private strafeT = 0;
  private nadeCdT = 0;
  blindT = 0;
  private seenT = -999;
  private lastSeenPos = new THREE.Vector3();
  private heardPos: THREE.Vector3 | null = null;
  private heardT = -999;
  private investigateT = 0;
  private wanderT = 0;
  private wanderOffset = new THREE.Vector3();
  private stuckT = 0;
  private detour: { pos: THREE.Vector3; t: number } | null = null;
  private guarding = false;
  private guardAngle = Math.random() * Math.PI * 2;
  private guardPos = new THREE.Vector3();
  private guardYaw: number | null = null;
  private holdYaw: number | null = null; // 到点后警戒方向（面向敌人来路/入口）
  private walkT = 0;
  private landVel = 0;
  private moveAlign = 1; // 身体朝向与移动方向的对齐度（用于卡住判定）
  /** 战术路线：前往包点前先经过的侧翼途经点（由开局战术分配） */
  route: THREE.Vector3[] | null = null;
  /** 战术路线对应的最终目标（用于判断是否还在前往包点） */
  objective = new THREE.Vector3();
  private aimErrT = 0;
  private aimErrYaw = 0;
  private aimErrPitch = 0;
  private aimErrTargetYaw = 0;
  private aimErrTargetPitch = 0;
  private deathT = 0;
  private interact: { type: 'plant' | 'defuse'; t: number; total: number } | null = null;
  actions: BotActions = {
    plant: false,
    plantProgress: 0,
    defuse: false,
    defuseProgress: 0,
    shot: null,
    nade: null,
  };

  constructor(name: string, team: Team, diff: BotDifficulty, brushes: Brush[]) {
    this.name = name;
    this.team = team;
    this.diff = diff;
    this.move = new MovementController(brushes);
    this.model = createBotModel(team);
    this.weapons.set('knife', new WeaponSystem('knife'));
    this.weapons.set('usp', new WeaponSystem('usp'));
    this.health = diff.hp;
  }

  get weapon(): WeaponSystem {
    return this.weapons.get(this.currentId) ?? this.weapons.get('usp')!;
  }

  get eyePos(): THREE.Vector3 {
    return new THREE.Vector3(this.move.pos.x, this.move.pos.y + 60, this.move.pos.z);
  }

  get viewYaw() {
    return this.aimYaw;
  }

  get viewPitch() {
    return this.aimPitch;
  }

  reset(
    spawn: THREE.Vector3,
    team: Team,
    money: number,
    role: 'siteA' | 'siteB' | 'mid' | 'bomb',
    siteChoice: 'A' | 'B',
    keepWeapons: boolean,
    yaw = team === 'T' ? 0 : Math.PI,
  ) {
    this.team = team;
    this.model.setTeam(team);
    this.move.reset(spawn);
    this.health = this.diff.hp;
    this.alive = true;
    this.state = 'idle';
    this.role = role;
    this.siteChoice = siteChoice;
    this.target = null;
    this.path = [];
    this.interact = null;
    this.heardPos = null;
    this.detour = null;
    this.guarding = false;
    this.guardYaw = null;
    this.holdYaw = null;
    this.route = null;
    this.walkT = 0;
    this.landVel = 0;
    this.moveAlign = 1;
    this.aimErrT = 0;
    this.aimErrYaw = 0;
    this.aimErrPitch = 0;
    this.aimErrTargetYaw = 0;
    this.aimErrTargetPitch = 0;
    this.nades = { he: 0, flash: 0, smoke: 0, molotov: 0 };
    this.blindT = 0;
    this.nadeCdT = 0;
    this.money = money;
    this.deathT = 0;
    this.model.group.rotation.set(0, 0, 0);
    this.model.group.position.copy(spawn);
    this.model.group.visible = true;
    if (!keepWeapons) {
      this.weapons.clear();
      this.weapons.set('knife', new WeaponSystem('knife'));
      this.weapons.set('usp', new WeaponSystem('usp'));
      this.switchSlot('secondary');
    }
    // 保留的武器每回合补满弹药（CS:GO 规则）
    for (const w of this.weapons.values()) {
      w.ammoInMag = w.def.magSize;
      w.reserve = w.def.reserve;
      w.reloading = false;
      w.reloadT = 0;
      w.scoped = false;
    }
    this.aimYaw = yaw;
  }

  buy() {
    // 简单购买策略：优先步枪/大狙 + 甲
    if (this.money >= 4750 && Math.random() < 0.22) {
      this.buyWeapon('awp');
    } else if (this.team === 'CT' && this.money >= 3100) {
      this.buyWeapon('m4');
    } else if (this.team === 'T' && this.money >= 2700) {
      this.buyWeapon('ak');
    }
    if (this.money >= 1000) {
      this.armor = 100;
      this.money -= 1000;
    }
    if (this.team === 'CT' && this.role === 'bomb' && this.money >= 400) {
      this.hasKit = true;
      this.money -= 400;
    }
    // 投掷物：优先高爆，其次闪光/烟雾
    const nadeOrder: NadeType[] = ['he', 'flash', 'smoke'];
    for (const id of nadeOrder) {
      const d = NADES[id];
      if (this.money >= d.price && this.nades[id] < d.max) {
        this.nades[id]++;
        this.money -= d.price;
      }
    }
  }

  buyWeapon(id: string) {
    const def = WEAPONS[id];
    if (!def || this.money < def.price) return false;
    if (this.weapons.has(id)) return false; // 已拥有同款枪，不重复购买
    this.money -= def.price;
    // 同槽位只能留一把：买新枪替换旧枪（CS:GO 规则）
    const toRemove: string[] = [];
    for (const [k, w] of this.weapons) {
      if (w.def.slot === def.slot) toRemove.push(k);
    }
    for (const k of toRemove) this.weapons.delete(k);
    this.weapons.set(id, new WeaponSystem(id));
    this.switchSlot(def.slot as 'primary' | 'secondary' | 'melee');
    return true;
  }

  switchSlot(slot: 'primary' | 'secondary' | 'melee') {
    if (slot === 'primary' && ![...this.weapons.values()].some((w) => w.def.slot === 'primary')) return;
    this.currentSlot = slot;
    if (slot === 'primary') {
      const p = [...this.weapons.values()].find((w) => w.def.slot === 'primary');
      this.currentId = p ? p.def.id : 'usp';
    } else if (slot === 'secondary') {
      this.currentId = 'usp';
    } else {
      this.currentId = 'knife';
    }
  }

  applyDamage(dmg: number) {
    if (!this.alive) return;
    this.health -= dmg;
    this.interact = null; // 被打断拆/装
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deaths++;
      this.state = 'dead';
      this.deathT = 0;
      sfx.play('death');
    }
  }

  /** 被攻击：解除警戒站位，立刻转向攻击来源 */
  onHurt(from: THREE.Vector3, worldTime: number) {
    this.heardPos = from.clone();
    this.heardT = worldTime - 0.5;
    this.holdYaw = null;
    this.reactionT = 0;
  }

  // ---------------------------------------------------------------
  update(dt: number, world: BotWorld, enemies: EnemyRef[]) {
    this.actions.plant = false;
    this.actions.defuse = false;
    this.actions.shot = null;
    this.actions.nade = null;
    this.blindT = Math.max(0, this.blindT - dt);
    this.nadeCdT -= dt;
    if (!this.alive) {
      this.deathT += dt;
      // 倒地动画：缓缓倒下并下沉
      const t = Math.min(1, this.deathT * 2.5);
      this.model.group.rotation.x = -t * Math.PI / 2 * 0.94;
      this.model.group.position.y = this.move.pos.y - t * 4;
      return;
    }

    if (this.frozen) {
      this.model.group.position.copy(this.move.pos);
      this.model.group.rotation.y = this.aimYaw;
      return;
    }

    if (this.lockMove) {
      this.model.group.position.copy(this.move.pos);
      this.model.group.rotation.y = this.aimYaw;
      return;
    }

    const w = this.weapon;
    const hSpeed = Math.hypot(this.move.vel.x, this.move.vel.z);
    const movingFrac = Math.min(1, hSpeed / this.weapon.def.moveSpeed);
    w.update(dt, movingFrac, !this.move.onGround);

    // ---- 感知 ----
    this.repathT -= dt;
    this.strafeT -= dt;
    this.burstT -= dt;
    this.investigateT -= dt;

    // 被闪光致盲时看不见敌人
    const visible = this.blindT > 0 ? null : this.findVisible(enemies, world);
    if (visible) {
      this.target = visible;
      this.reactionT -= dt;
      this.lastSeenPos.copy(visible.pos);
      this.seenT = world.time;
    } else {
      this.target = null;
      this.reactionT = this.diff.reactionMin + Math.random() * (this.diff.reactionMax - this.diff.reactionMin);
    }

    // 听到枪声
    for (const n of world.noises) {
      if (n.team === this.team) continue; // 自己人的枪声不调查
      const d = this.move.pos.distanceTo(n.pos);
      if (d < n.radius && world.time - this.heardT > 1.2) {
        this.heardPos = n.pos.clone();
        this.heardT = world.time;
      }
    }

    // ---- 状态机 ----
    const isCarrier = this.team === 'T' && this.hasBomb && !world.bombPlanted;
    const distToTarget = this.target ? this.move.pos.distanceTo(this.target.pos) : Infinity;
    // 带包者以装包为第一要务：除非敌人贴脸（<200）或时间紧急，否则不恋战，冲去包点
    // 包掉在地上时，无包者优先去捡包（不恋战），除非敌人贴脸
    const bombOnGround = this.team === 'T' && !!world.bombDropped && !this.hasBomb;
    if (this.target && this.reactionT <= 0 && !(isCarrier && distToTarget > 200) && !(bombOnGround && distToTarget > 200)) {
      this.state = 'combat';
    } else if (this.team === 'T' && world.bombPlanted) {
      this.state = 'advance'; // 守包：散开到包点四周，面向敌人来路
      this.role = 'bomb';
      this.beginGuard(world);
      this.setTarget(this.guardPos);
    } else if (this.team === 'CT' && world.bombPlanted) {
      this.state = 'advance';
      this.role = 'bomb';
      this.setTarget(world.bombPos);
    } else if (this.team === 'T' && this.hasBomb && !world.bombPlanted) {
      // 带包者优先去包点，不被枪声干扰
      this.state = 'advance';
      this.setTarget(this.objectivePos(world));
    } else if (this.team === 'T' && world.bombDropped && !this.hasBomb) {
      // 捡包优先于听声调查，否则炸弹永远没人捡
      this.state = 'advance';
      this.setTarget(world.bombDropped);
    } else if (world.time - this.heardT < 4 && this.heardPos) {
      this.state = 'advance';
      this.setTarget(this.heardPos);
    } else {
      this.state = 'advance';
      this.setTarget(this.objectivePos(world));
    }

    // ---- 装包 / 拆包 ----
    this.handleInteract(dt, world);

    // ---- 战斗 ----
    let wishX = 0, wishZ = 0, jump = false;
    if (this.state === 'combat' && this.target) {
      this.combatUpdate(dt, world);
      // 移动：横向拉扯，easy 停下来打
      if (this.diff.moveShoot || this.burstLeft <= 0) {
        if (this.strafeT <= 0) {
          this.strafeDir = Math.random() < 0.5 ? -1 : 1;
          this.strafeT = 0.5 + Math.random() * 0.8;
        }
        const f = new THREE.Vector3(Math.sin(this.aimYaw), 0, Math.cos(this.aimYaw));
        const r = new THREE.Vector3(f.z, 0, -f.x);
        const dToTarget = this.move.pos.distanceTo(this.target.pos);
        if (dToTarget > 420) {
          // 距离远：边拉枪边推进，避免隔着半张图互喷
          wishX = f.x * 0.75 + r.x * this.strafeDir * 0.5;
          wishZ = f.z * 0.75 + r.z * this.strafeDir * 0.5;
        } else {
          wishX = r.x * this.strafeDir;
          wishZ = r.z * this.strafeDir;
        }
      }
    } else {
      this.followPath(dt);
      const dir = this.nextPathDir();
      wishX = dir.x;
      wishZ = dir.z;
      // 朝移动方向转向，保证前进时面向敌人可能出现的方位
      if (wishX !== 0 || wishZ !== 0) {
        this.aimYaw = turnToward(this.aimYaw, Math.atan2(wishX, wishZ), 2.4 * dt);
        // 身体没转过来之前放慢脚步：先转身再跑，避免“边跑边转头”的抖动感
        const ax = Math.sin(this.aimYaw);
        const az = Math.cos(this.aimYaw);
        this.moveAlign = Math.max(0, ax * wishX + az * wishZ);
        const slow = 0.3 + 0.7 * this.moveAlign;
        wishX *= slow;
        wishZ *= slow;
      }
    }

    // 卡住检测：已经面向目标却走不动（避免把“原地转身”误判成卡住）
    if (this.state === 'advance' && this.path.length > 1 && this.moveAlign > 0.7) {
      if (Math.hypot(this.move.vel.x, this.move.vel.z) < 25) {
        this.stuckT += dt;
        if (this.stuckT > 1.0) {
          this.repathT = 0;
          this.stuckT = 0;
          if (!this.detour || this.detour.t <= 0) {
            this.detour = { pos: this.pickDetourPoint(world), t: 2.2 };
          }
        }
      } else {
        this.stuckT = 0;
      }
    }

    if (this.lockMove) {
      wishX = 0;
      wishZ = 0;
      this.move.vel.x = 0;
      this.move.vel.z = 0;
    }
    // 装包/拆包时站定，避免轻微移动打断进度
    if (this.interact) {
      wishX = 0;
      wishZ = 0;
    }
    // 固定子步长积分
    const STEP = 1 / 120;
    let remaining = dt;
    while (remaining > 0.0001) {
      const h = Math.min(STEP, remaining);
    this.move.update(h, wishX, wishZ, jump, false, false, this.weapon.def.moveSpeed);
      remaining -= h;
    }
    // 脚步声（落地 + 步行节奏，音量比玩家略低）
    if (this.move.onGround && this.landVel < -320) sfx.play('footstep_bot');
    this.landVel = this.move.vel.y;
    const stepSpeed = Math.hypot(this.move.vel.x, this.move.vel.z);
    if (this.move.onGround && stepSpeed > 40) {
      this.walkT += dt * stepSpeed / FEEL.walkSpeed;
      if (Math.floor(this.walkT * 3.2) !== Math.floor((this.walkT - dt) * 3.2)) sfx.play('footstep_bot');
    } else {
      this.walkT = 0;
    }
    // 到点持枪警戒（仅 CT 防守用）：面向敌人来路（如 B 点唯一入口）；T 无包时应主动猎杀
    if (!this.guarding && this.team === 'CT') {
      const finalPt = this.path.length ? this.path[this.path.length - 1] : null;
      const arrived =
        !!finalPt &&
        this.pathIdx >= this.path.length - 1 &&
        this.move.pos.distanceTo(finalPt) < 150;
      if (arrived && !this.target && this.state === 'advance') {
        if (this.holdYaw === null) {
          const map = botWorldMap.get(this);
          const enemySpawns = map?.spawns.t; // CT 防守：敌人从 T 家方向来
          if (map && enemySpawns && enemySpawns.length) {
            const avg = new THREE.Vector3();
            for (const sp of enemySpawns) avg.add(sp);
            avg.divideScalar(enemySpawns.length);
            this.holdYaw = Math.atan2(avg.x - finalPt.x, avg.z - finalPt.z);
          } else {
            this.holdYaw = this.aimYaw;
          }
        }
      } else {
        this.holdYaw = null;
      }
    }
    // 站桩时缓慢扫视，避免漏看侧后方敌人
    if (hSpeed < 25 && this.state !== 'combat' && this.move.onGround) {
      this.aimYaw += Math.sin(performance.now() / 1000 * 0.7) * 0.3 * dt;
    }
    // 警戒中：视线收在入口方向（配合上面的缓慢扫视）
    if (this.holdYaw !== null && !this.target && !this.guarding && this.state === 'advance') {
      this.aimYaw = turnToward(this.aimYaw, this.holdYaw, 2.4 * dt);
    }
    // 守包：到了站位后看向敌人来路（已按墙体视线选好方向），配合上面的扫视；走动调查时不锁视线
    if (this.guarding && !this.target && this.state === 'advance' && this.move.pos.distanceTo(this.guardPos) < 150) {
      this.aimYaw = turnToward(this.aimYaw, this.guardYaw ?? this.aimYaw, 2.4 * dt);
    }
    this.model.group.position.set(this.move.pos.x, this.move.pos.y, this.move.pos.z);
    this.model.group.rotation.y = this.aimYaw;

    // 走路/持枪动画（拟人：双手握枪，肘部弯曲；刀时自然摆臂）
    const holdingGun = !this.weapon.isKnife;
    this.model.gun.visible = holdingGun;
    const t = performance.now() / 1000 * 9;
    const moving = hSpeed > 30 && this.move.onGround;
    const swing = moving ? Math.sin(t) : 0;
    this.model.legs[0].rotation.x = swing * 0.7;
    this.model.legs[1].rotation.x = -swing * 0.7;
    if (holdingGun) {
      // 右手握把（后手）、左手护木（前手），随步伐轻微前后摆动
      const rightHand = new THREE.Vector3(3.0, 49.5 + swing * 1.0, 4.5 - swing * 2.5);
      const leftHand = new THREE.Vector3(1.8, 51.5 - swing * 0.8, 12.5 + swing * 2.0);
      poseArm(this.model.arms[0], rightHand, Math.abs(swing) * 0.35);
      poseArm(this.model.arms[1], leftHand, Math.abs(swing) * 0.35);
    } else {
      // 持刀：手臂自然下垂前后摆动
      const rightHand = new THREE.Vector3(5.5, 42 + swing * 3, 2 - swing * 9);
      const leftHand = new THREE.Vector3(-5.5, 42 - swing * 3, 2 + swing * 9);
      poseArm(this.model.arms[0], rightHand, Math.abs(swing));
      poseArm(this.model.arms[1], leftHand, Math.abs(swing));
    }
    // 举枪跟随视线俯仰
    this.model.gun.rotation.x = -this.aimPitch * 0.8;
  }

  // ---------------------------------------------------------------
  private findVisible(enemies: EnemyRef[], world: BotWorld): EnemyRef | null {
    let best: EnemyRef | null = null;
    let bestScore = Infinity;
    const fwd = new THREE.Vector3(Math.sin(this.aimYaw), 0, Math.cos(this.aimYaw));
    const eye = this.eyePos;
    for (const e of enemies) {
      if (!e.alive) continue;
      const to = new THREE.Vector3().subVectors(e.pos, this.move.pos);
      const dist = to.length();
      if (dist > 4096) continue;
      to.y += 50;
      const dir = to.clone().normalize();
      // FOV：近距离（约 5 米）360° 感知，远距离才受视野限制——避免“敌人走到脸上都不管”
      const fovDot = Math.cos((this.diff.fov / 2) * Math.PI / 180);
      const flatDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
      if (dist > 500 && fwd.dot(flatDir) < fovDot) continue;
      // LOS
      const hit = MovementController.raycastBrushes(world.brushes, eye, dir, dist + 10);
      if (hit <= dist - 6) continue;
      // 烟雾遮挡视线
      let inSmoke = false;
      for (const s of world.smokes) {
        if (distToSegment(s.pos, eye, new THREE.Vector3(e.pos.x, e.pos.y + 50, e.pos.z)) < s.radius * 0.5) {
          inSmoke = true;
          break;
        }
      }
      if (inSmoke) continue;
      const score = dist - flatDir.dot(fwd) * 200; // 更近、更居中者优先
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private objectivePos(world: BotWorld): THREE.Vector3 {
    if (this.team === 'T') {
      // 没带包、包也没掉/没装：去猎杀 CT（往敌方一侧推进），而不是守着包点
      if (!this.hasBomb && !world.bombPlanted && !world.bombDropped) {
        const map = botWorldMap.get(this);
        if (map && map.spawns.ct.length) {
          const avg = new THREE.Vector3();
          for (const s of map.spawns.ct) avg.add(s);
          avg.divideScalar(map.spawns.ct.length);
          const hunt = avg.multiplyScalar(0.55); // 55% 往 CT 家方向，避免直接冲进对方家里
          const tile = map.nav.worldToTile(hunt);
          if (map.nav.isWalkable(tile.x, tile.z)) return hunt;
          const alt = map.nav.nearestWalkable(tile.x, tile.z);
          if (alt) return map.nav.tileToWorld(alt.x, alt.z);
        }
      }
      const site = world.map.sites.find((s) => s.id === this.siteChoice);
      if (site) return site.pos.clone();
    } else {
      if (this.role === 'mid') {
        // 中路 = 地图中心附近最近的可行走格子（旧公式算到了地图角落的墙里）
        const map = botWorldMap.get(this);
        if (map) {
          const cx = Math.floor(map.def.w / 2);
          const cz = Math.floor(map.def.h / 2);
          const alt = map.nav.nearestWalkable(cx, cz);
          if (alt) return map.nav.tileToWorld(alt.x, alt.z);
        }
        return new THREE.Vector3(0, 0, 0);
      }
      const site = world.map.sites.find((s) => s.id === (this.role === 'siteA' ? 'A' : 'B'));
      if (site) return site.pos.clone();
    }
    return new THREE.Vector3(0, 0, 0);
  }

  private setTarget(pos: THREE.Vector3) {
    // 目标变化（如掉包/听到枪声）时立即改道，不再等 1.2 秒节流
    const end = this.path.length ? this.path[this.path.length - 1] : null;
    const changed = !end || end.distanceToSquared(pos) > 90 * 90;
    if (!changed && this.repathT > 0 && this.path.length > 1) return;
    if (!this.target || this.target.alive) {
      this.path = worldPath(this, pos);
      this.pathIdx = 0;
      this.repathT = 1.2;
    }
  }

  private nextPathDir(): THREE.Vector3 {
    // 卡住绕行：优先走向临时的脱困点
    if (this.detour && this.detour.t > 0) {
      const dx = this.detour.pos.x - this.move.pos.x;
      const dz = this.detour.pos.z - this.move.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 55) this.detour = null;
      return d > 0.001 ? new THREE.Vector3(dx / d, 0, dz / d) : new THREE.Vector3();
    }
    if (!this.path.length) return new THREE.Vector3();
    const target = this.path[Math.min(this.pathIdx, this.path.length - 1)].clone();
    if (this.pathIdx >= this.path.length - 1) {
      // 终点的随机游走：若偏移指向墙里则吸附到最近可通行点，避免撞墙
      const nav = botWorldMap.get(this)?.nav;
      if (nav && this.wanderOffset.lengthSq() > 0) {
        const cand = target.clone().add(this.wanderOffset);
        const tile = nav.worldToTile(cand);
        if (nav.isWalkable(tile.x, tile.z) && nav.segmentClear(this.move.pos, cand)) {
          target.copy(cand);
        } else {
          const alt = nav.nearestWalkable(tile.x, tile.z);
          if (alt) {
            const altPos = nav.tileToWorld(alt.x, alt.z);
            if (nav.segmentClear(this.move.pos, altPos)) target.copy(altPos);
            else this.wanderOffset.set(0, 0, 0);
          } else {
            this.wanderOffset.set(0, 0, 0); // 周围没空地就原地待着
          }
        }
      }
    }
    const dx = target.x - this.move.pos.x;
    const dz = target.z - this.move.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 55) {
      this.pathIdx = Math.min(this.pathIdx + 1, this.path.length - 1);
    }
    return d > 0.001 ? new THREE.Vector3(dx / d, 0, dz / d) : new THREE.Vector3();
  }

  private followPath(dt: number) {
    if (this.detour) {
      this.detour.t -= dt;
      if (this.detour.t <= 0) this.detour = null;
    }
    if (this.guarding || this.holdYaw !== null) return; // 守包/警戒：固定站位，不随机游走
    // 快到目标时加一点随机游走，避免扎堆
    if (this.path.length && this.pathIdx >= this.path.length - 1) {
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 1.5 + Math.random() * 2;
        // 游走点尽量落在面前 ±50°，避免随机偏移突然指到身后导致急甩头
        const ang = this.aimYaw + (Math.random() - 0.5) * 1.7;
        const dist = 45 + Math.random() * 130;
        this.wanderOffset.set(Math.sin(ang) * dist, 0, Math.cos(ang) * dist);
      }
    }
  }

  /** 开始守包：确定一个散开站位（包点四周一圈，彼此不重叠） */
  private beginGuard(world: BotWorld) {
    if (this.guarding) return;
    this.guarding = true;
    this.guardPos.copy(this.pickGuardPos(world));
    this.guardYaw = this.computeGuardYaw(world);
  }

  /** 守包朝向：优先面向敌人来路（CT 侧），若被墙挡则搜索一条开阔视线 */
  private computeGuardYaw(world: BotWorld): number {
    const map = botWorldMap.get(this);
    const enemySpawns = map?.spawns.ct;
    let baseAng = this.aimYaw;
    if (map && enemySpawns && enemySpawns.length) {
      const avg = new THREE.Vector3();
      for (const s of enemySpawns) avg.add(s);
      avg.divideScalar(enemySpawns.length);
      baseAng = Math.atan2(avg.x - this.guardPos.x, avg.z - this.guardPos.z);
    }
    const eye = new THREE.Vector3(this.guardPos.x, 60, this.guardPos.z);
    for (let k = 0; k < 10; k++) {
      const ang = baseAng + (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
      const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
      const hit = MovementController.raycastBrushes(world.brushes, eye, dir, 420);
      if (hit >= 390) return ang; // 这个方向 400 内没墙
    }
    // 都挡就面向包点（包点内部通常是开阔的）
    const toBomb = Math.atan2(world.bombPos.x - this.guardPos.x, world.bombPos.z - this.guardPos.z);
    return toBomb;
  }

  private pickGuardPos(world: BotWorld): THREE.Vector3 {
    const map = botWorldMap.get(this);
    const nav = map?.nav;
    const bomb = world.bombPos;
    if (!map || !nav || !map.spawns.t.length) return bomb.clone();
    // 从 T 出生指向包点的方向为基准，绕包点一圈按各自角度散开
    const tAvg = new THREE.Vector3();
    for (const s of map.spawns.t) tAvg.add(s);
    tAvg.divideScalar(map.spawns.t.length);
    const base = bomb.clone().sub(tAvg);
    base.y = 0;
    if (base.lengthSq() < 1) base.set(1, 0, 0);
    base.normalize();
    const c = Math.cos(this.guardAngle);
    const s = Math.sin(this.guardAngle);
    const off = new THREE.Vector3(base.x * c - base.z * s, 0, base.x * s + base.z * c);
    // 在环形上试几个点，选最近的可走点（避免 nearestWalkable 吸附到远处）
    for (let k = 0; k < 8; k++) {
      const ang = this.guardAngle + (Math.random() - 0.5) * 0.9;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const o = new THREE.Vector3(base.x * ca - base.z * sa, 0, base.x * sa + base.z * ca);
      const cand = bomb.clone().addScaledVector(o, 175 + Math.random() * 85);
      const tile = nav.worldToTile(cand);
      if (nav.isWalkable(tile.x, tile.z)) return cand;
    }
    return bomb.clone(); // 周围实在没空地就贴着包点守
  }

  /** 卡住时选一个附近可走、直线不撞墙的点作为临时脱困目标 */
  private pickDetourPoint(world: BotWorld): THREE.Vector3 {
    const nav = botWorldMap.get(this)?.nav;
    for (let k = 0; k < 10; k++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 130 + Math.random() * 150;
      const cand = new THREE.Vector3(
        this.move.pos.x + Math.cos(ang) * dist,
        0,
        this.move.pos.z + Math.sin(ang) * dist,
      );
      if (nav) {
        const t = nav.worldToTile(cand);
        if (!nav.isWalkable(t.x, t.z)) continue;
        if (!nav.segmentClear(this.move.pos, cand)) continue;
      }
      return cand;
    }
    return this.move.pos.clone();
  }

  private handleInteract(dt: number, world: BotWorld) {
    // T 装包
    if (this.team === 'T' && this.hasBomb && !world.bombPlanted) {
      const site = world.map.sites.find((s) => s.id === this.siteChoice);
      if (site && this.move.pos.distanceTo(site.pos) < site.radius) {
        if (!this.interact) this.interact = { type: 'plant', t: 0, total: MATCH.plantTime };
        this.interact.t += dt;
        this.actions.plant = true;
        this.actions.plantProgress = this.interact.t / this.interact.total;
        if (this.interact.t >= this.interact.total) {
          this.interact = null;
          this.hasBomb = false;
          this.actions.plantProgress = 1;
        }
        return;
      }
    }
    // CT 拆包
    if (this.team === 'CT' && world.bombPlanted) {
      if (this.move.pos.distanceTo(world.bombPos) < 120) {
        if (!this.interact) this.interact = {
          type: 'defuse',
          t: 0,
          total: this.hasKit ? MATCH.kitDefuseTime : MATCH.defuseTime,
        };
        this.interact.t += dt;
        this.actions.defuse = true;
        this.actions.defuseProgress = this.interact.t / this.interact.total;
        if (this.interact.t >= this.interact.total) {
          this.interact = null;
          this.actions.defuseProgress = 1;
        }
        return;
      }
    }
    this.interact = null;
  }

  private combatUpdate(dt: number, world: BotWorld) {
    const t = this.target!;
    // 瞄准：指向目标（含预判与误差）
    const eye = this.eyePos;
    const aim = new THREE.Vector3(t.pos.x, t.pos.y + 50, t.pos.z);
    if (t.isPlayer) aim.y += 10;
    // 预判
    const to = aim.clone().sub(eye);
    const dist = to.length();
    const projSpeed = this.weapon.def.id === 'awp' ? 3800 : 3000;
    aim.addScaledVector(t.vel, (dist / projSpeed) * this.diff.aimLead);
    const targetYaw = Math.atan2(aim.x - eye.x, aim.z - eye.z);
    const flat = Math.hypot(aim.x - eye.x, aim.z - eye.z);
    const targetPitch = Math.atan2(aim.y - eye.y, flat);

    // 带误差缓慢转向：误差偏移每隔一小段重新取，且新误差平滑过渡，避免镜头突然左右甩
    this.aimErrT -= dt;
    if (this.aimErrT <= 0) {
      this.aimErrT = 0.35 + Math.random() * 0.5;
      this.aimErrTargetYaw = (Math.random() - 0.5) * 2 * this.diff.aimError;
      this.aimErrTargetPitch = (Math.random() - 0.5) * 2 * this.diff.aimError;
    }
    const errBlend = Math.min(1, dt * 3.2);
    this.aimErrYaw += (this.aimErrTargetYaw - this.aimErrYaw) * errBlend;
    this.aimErrPitch += (this.aimErrTargetPitch - this.aimErrPitch) * errBlend;
    const maxTurn = this.diff.aimTurnSpeed * dt;
    const dy = wrapAngle(targetYaw + this.aimErrYaw - this.aimYaw);
    this.aimYaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
    const dp = clamp(targetPitch + this.aimErrPitch - this.aimPitch, -1, 1);
    this.aimPitch += Math.max(-maxTurn, Math.min(maxTurn, dp));

    // 开火判定
    const fwd = new THREE.Vector3(
      Math.cos(this.aimPitch) * Math.sin(this.aimYaw),
      Math.sin(this.aimPitch),
      Math.cos(this.aimPitch) * Math.cos(this.aimYaw),
    );
    const toTarget = aim.clone().sub(eye).normalize();
    const align = fwd.dot(toTarget);
    // 弹道自检：枪口方向的射线能真正到达目标（中途不被墙挡）才开火
    const shotClear = MovementController.raycastBrushes(world.brushes, eye, fwd, dist + 30) > dist - 12;

    if (align > 0.985 && shotClear) {
      // 距离太近 → 用刀
      if (dist < 110 && (this.weapon.isKnife || !this.weapon.def.id.startsWith('a'))) {
        this.switchSlot('melee');
      } else if (this.weapon.isKnife && dist > 120) {
        this.switchSlot(this.weapons.has('ak') || this.weapons.has('m4') || this.weapons.has('awp') ? 'primary' : 'secondary');
      }
      const w = this.weapon;
      if (w.isKnife) {
        if (dist < 110 && w.swingT <= 0) {
          const out = { dir: new THREE.Vector3() };
          w.fire(fwd, 0, false, out);
          this.actions.shot = { origin: this.eyePos, dir: out.dir };
        }
      } else {
        if (w.ammoInMag <= 0 && !w.reloading) {
          w.startReload();
          sfx.play('reload');
        }
        if (this.burstLeft <= 0 && this.burstT <= 0) {
          this.burstLeft = Math.floor(this.diff.burstMin + Math.random() * (this.diff.burstMax - this.diff.burstMin + 1));
          this.burstT = this.diff.burstPause;
        }
        if (this.burstLeft > 0 && this.burstT <= 0 && !w.reloading) {
          if (w.def.auto || w.def.id === 'awp' || w.def.id === 'usp') {
            const out = { dir: new THREE.Vector3() };
            const fired = w.fire(fwd, 0, false, out);
            if (fired) {
              this.actions.shot = { origin: this.eyePos, dir: out.dir };
              this.burstLeft--;
              const sound = w.def.id === 'awp' ? 'shot_awp' : w.def.slot === 'secondary' ? 'shot_pistol' : 'shot_rifle';
              sfx.play(sound);
              if (w.def.id === 'awp') this.burstLeft = 0;
            }
          }
        }
      }
    }

    // 投掷物：远距离丢高爆，近距补闪光
    if (this.nadeCdT <= 0 && this.actions.nade === null && !this.weapon.isKnife) {
      const canHe = this.nades.he > 0 && dist > 260 && dist < 1500;
      const canFlash = this.nades.flash > 0 && dist > 120 && dist < 650;
      if (canHe || canFlash) {
        const type: NadeType = canHe && (!canFlash || Math.random() < 0.65) ? 'he' : 'flash';
        this.nades[type]--;
        this.nadeCdT = 6 + Math.random() * 4;
        const lead = new THREE.Vector3().copy(t.pos).addScaledVector(t.vel, dist / 750).add(new THREE.Vector3(0, 40, 0));
        const throwDir = lead.clone().sub(eye).normalize();
        this.actions.nade = { type, dir: throwDir, cook: Math.random() * 0.7 };
      }
    }
    // 被打后转身寻找
    if (world.time - this.seenT > 2.5 && !this.target?.alive) {
      this.aimYaw += Math.sin(world.time * 2) * 0.2;
    }
    void dt;
  }
}

const pathCache = new WeakMap<Bot, { from: THREE.Vector3; to: THREE.Vector3; path: THREE.Vector3[] | null }>();

function worldPath(bot: Bot, to: THREE.Vector3): THREE.Vector3[] {
  const map = botWorldMap.get(bot);
  if (!map) return [to.clone()];
  // 战术路线：只在前往包点目标时生效（被枪声/掉包等临时改道时走最近路线）
  if (bot.route && bot.route.length && to.distanceToSquared(bot.objective) < 120 * 120) {
    const pts = [bot.move.pos.clone(), ...bot.route.map((p) => p.clone()), to.clone()];
    const full: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = map.nav.findPath(pts[i], pts[i + 1]);
      if (!seg || seg.length < 2) return [to.clone()];
      full.push(...seg.slice(0, -1));
    }
    full.push(to.clone());
    return full;
  }
  const cached = pathCache.get(bot);
  if (cached && cached.from.distanceToSquared(bot.move.pos) < 64 * 64 && cached.to.distanceToSquared(to) < 48 * 48) {
    return cached.path ?? [to.clone()];
  }
  const path = map.nav.findPath(bot.move.pos, to);
  pathCache.set(bot, { from: bot.move.pos.clone(), to: to.clone(), path });
  return path ?? [to.clone()];
}

const botWorldMap = new WeakMap<Bot, CompiledMap>();
export function attachBotWorldMap(bot: Bot, map: CompiledMap) {
  botWorldMap.set(bot, map);
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function turnToward(current: number, target: number, maxDelta: number) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + Math.max(-maxDelta, Math.min(maxDelta, d));
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/** 点到线段的最短距离 */
function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  if (len2 < 1e-6) return p.distanceTo(a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
}
