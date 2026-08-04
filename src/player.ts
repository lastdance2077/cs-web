import * as THREE from 'three';
import { FEEL, WEAPONS as WEAPON_DEFS, type Team } from './config';
import { MovementController } from './movement';
import { createViewmodel, createPlayerHitboxes, muzzleOffset, type HitBox } from './models';
import { WeaponSystem } from './weapons';
import { sfx } from './audio';

export interface InputState {
  keys: Set<string>;
  mouseDX: number;
  mouseDY: number;
  fire: boolean;
  rmb: boolean;
  wheel: number;
  interact: boolean;
  reload: boolean;
  buy: boolean;
  slot: number; // 0 不切，1 主武器, 2 手枪, 3 刀
  scoreboard: boolean;
}

const BASE_FOV = 68;

export class PlayerController {
  move: MovementController;
  camera: THREE.PerspectiveCamera;
  viewmodel: THREE.Group;
  hitboxes: HitBox[];
  hitboxGroup: THREE.Group;

  team: Team;
  health = 100;
  armor = 100;
  money = 4000;
  alive = true;
  hasBomb = false;
  hasKit = false;
  kills = 0;
  deaths = 0;
  isPlayer = true;
  name = '玩家';
  god = false; // 调试用无敌开关
  lockMove = false; // 冻结期锁移动（仍可转视角）

  yaw = 0;
  pitch = 0;
  viewPunchX = 0; // 视角上抬（回弹）
  viewPunchY = 0;

  weapons = new Map<string, WeaponSystem>();
  currentSlot: 'primary' | 'secondary' | 'melee' = 'secondary';
  private currentId = 'usp';

  private bobT = 0;
  private walkT = 0;
  private lastHorizontal = 0;
  private landVel = 0;
  private jumpHeld = false;
  private muzzleFlash = 0;
  private flashSprite: THREE.Sprite;
  private flashLight: THREE.PointLight;

  constructor(
    scene: THREE.Scene,
    brushes: MovementController['brushes'],
    team: Team,
  ) {
    this.move = new MovementController(brushes);
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 12000);
    this.team = team;

    this.weapons.set('knife', new WeaponSystem('knife'));
    this.weapons.set('usp', new WeaponSystem('usp'));

    this.viewmodel = createViewmodel('usp');
    this.viewmodel.position.set(0.5, -0.5, -2.2);
    this.camera.add(this.viewmodel);

    const flashMat = new THREE.SpriteMaterial({
      map: createMuzzleTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flashSprite = new THREE.Sprite(flashMat);
    this.flashSprite.scale.set(0.14, 0.14, 1);
    this.flashSprite.visible = false;
    this.flashLight = new THREE.PointLight(0xffbb66, 0, 8);
    this.camera.add(this.flashSprite, this.flashLight);

    const hb = createPlayerHitboxes();
    this.hitboxGroup = hb.group;
    this.hitboxes = hb.hitboxes;
    this.hitboxGroup.visible = false;
    scene.add(this.hitboxGroup);
    scene.add(this.camera);
  }

  reset(spawn: THREE.Vector3, team: Team, money: number, keepWeapons: boolean, yaw = team === 'T' ? 0 : Math.PI) {
    this.team = team;
    this.move.reset(spawn);
    this.health = 100;
    this.alive = true;
    this.yaw = yaw;
    this.pitch = 0;
    this.viewPunchX = 0;
    this.viewPunchY = 0;
    if (!keepWeapons) {
      this.weapons.clear();
      this.weapons.set('knife', new WeaponSystem('knife'));
      this.weapons.set('usp', new WeaponSystem('usp'));
      this.switchSlot('secondary');
    }
    this.money = money;
    this.currentSlot = 'secondary';
    if (!this.weapons.has('usp')) this.weapons.set('usp', new WeaponSystem('usp'));
    if (!this.weapons.has('knife')) this.weapons.set('knife', new WeaponSystem('knife'));
  }

  get weapon(): WeaponSystem {
    return this.weapons.get(this.currentId) ?? this.weapons.get('usp')!;
  }

  buyWeapon(id: string): boolean {
    const def = WEAPON_DEFS[id];
    if (!def) return false;
    if (this.money < def.price) return false;
    this.money -= def.price;
    const slot: 'primary' | 'secondary' | 'melee' = def.slot === 'melee' ? 'melee' : def.slot === 'secondary' ? 'secondary' : 'primary';
    this.weapons.set(id, new WeaponSystem(id));
    if (slot === 'primary') this.currentSlot = 'primary';
    else if (slot === 'secondary') this.currentSlot = 'secondary';
    this.updateCurrentId();
    sfx.play('buy');
    return true;
  }

  private updateCurrentId() {
    if (this.currentSlot === 'primary') {
      const p = [...this.weapons.values()].find((w) => w.def.slot === 'primary');
      this.currentId = p ? p.def.id : 'usp';
    } else if (this.currentSlot === 'secondary') {
      this.currentId = 'usp';
    } else {
      this.currentId = 'knife';
    }
    // 换武器时重置视角回弹与瞄准
    this.viewPunchX = 0;
    this.viewPunchY = 0;
    this.weapon.scoped = false;
    const vm = this.viewmodel;
    vm.clear();
    const g = createViewmodel(this.currentId);
    g.scale.setScalar(0.22); // 把第一人称武器缩到合适屏幕大小
    vm.add(g);
  }

  switchSlot(slot: 'primary' | 'secondary' | 'melee') {
    if (slot === 'primary' && ![...this.weapons.values()].some((w) => w.def.slot === 'primary')) return;
    this.currentSlot = slot;
    this.updateCurrentId();
  }

  cycleWeapon(dir: number) {
    const order: Array<'melee' | 'secondary' | 'primary'> = ['melee', 'secondary', 'primary'];
    const i = order.indexOf(this.currentSlot);
    const next = order[(i + dir + 3) % 3];
    this.switchSlot(next);
  }

  update(dt: number, input: InputState) {
    // 输入 → 期望方向
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let wx = 0, wz = 0;
    if (input.keys.has('KeyW')) { wx += f.x; wz += f.z; }
    if (input.keys.has('KeyS')) { wx -= f.x; wz -= f.z; }
    if (input.keys.has('KeyD')) { wx += r.x; wz += r.z; }
    if (input.keys.has('KeyA')) { wx -= r.x; wz -= r.z; }
    const walk = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
    const duck = input.keys.has('ControlLeft') || input.keys.has('ControlRight');
    // 跳跃改为边沿触发：按住空格只跳一次，避免无限连跳
    const jump = input.keys.has('Space') && !this.jumpHeld;
    if (input.keys.has('Space')) this.jumpHeld = true;
    else this.jumpHeld = false;

    if (this.lockMove) {
      wx = 0;
      wz = 0;
      this.move.vel.x = 0;
      this.move.vel.z = 0;
    }
    // 固定子步长积分：低帧率下也保持手感不发飘
    const STEP = 1 / 120;
    let remaining = dt;
    while (remaining > 0.0001) {
      const h = Math.min(STEP, remaining);
      this.move.update(h, wx, wz, this.lockMove ? false : jump, duck, walk, this.weapon.def.moveSpeed);
      remaining -= h;
    }

    // 落地音效
    if (this.move.onGround && this.landVel < -320) sfx.play('footstep');
    this.landVel = this.move.vel.y;

    // 脚步声
    const hSpeed = Math.hypot(this.move.vel.x, this.move.vel.z);
    if (this.move.onGround && hSpeed > 40) {
      this.walkT += dt * hSpeed / FEEL.walkSpeed;
      if (Math.floor(this.walkT * 3.2) !== Math.floor((this.walkT - dt) * 3.2)) sfx.play('footstep');
    } else {
      this.walkT = 0;
    }

    // 视角
    this.yaw -= input.mouseDX * FEEL.mouseSens;
    this.pitch -= input.mouseDY * FEEL.mouseSens;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    const mouseDX = input.mouseDX;
    const mouseDY = input.mouseDY;
    input.mouseDX = 0;
    input.mouseDY = 0;

    // 视角回弹恢复
    this.viewPunchX -= this.viewPunchX * Math.min(1, FEEL.viewPunchRecover * dt);
    this.viewPunchY -= this.viewPunchY * Math.min(1, FEEL.viewPunchRecover * dt);

    const camX = this.move.pos.x;
    const camY = this.move.pos.y + (this.move.ducking ? FEEL.duckEyeHeight : FEEL.eyeHeight);
    const camZ = this.move.pos.z;
    this.camera.position.set(camX, camY, camZ);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + this.viewPunchY;
    this.camera.rotation.x = this.pitch + this.viewPunchX;
    this.camera.rotation.z = 0;

    this.hitboxGroup.position.set(this.move.pos.x, this.move.pos.y, this.move.pos.z);
    this.hitboxGroup.rotation.y = this.yaw;

    // 武器
    const w = this.weapon;
    const movingFrac = Math.min(1, hSpeed / this.weapon.def.moveSpeed);
    w.update(dt, movingFrac, !this.move.onGround);

    // 开镜
    if (w.def.zoom && input.rmb && !w.reloading) w.scoped = true;
    else w.scoped = false;
    const targetFov = w.scoped && w.def.zoom ? w.def.zoom : BASE_FOV;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, FEEL.zoomSpeed * dt);
    this.camera.updateProjectionMatrix();

    // 武器动画：摇摆 + 后座
    this.bobT += dt * (w.scoped ? 0.4 : 1) * (0.25 + movingFrac * 0.75);
    const bobY = Math.sin(this.bobT * 9) * 0.012 * movingFrac;
    const bobX = Math.cos(this.bobT * 4.5) * 0.008 * movingFrac;
    const base = new THREE.Vector3(0.5 + bobX, -0.5 + bobY, -2.2);
    base.y -= w.reloading ? 0.16 : 0;
    base.y += w.scoped ? 0.14 : 0;
    base.x -= w.scoped ? 0.12 : 0;
    base.z += w.scoped ? 0.25 : 0;
    base.x += mouseDX * 0.002;
    base.y += mouseDY * 0.002;
    this.viewmodel.position.lerp(base, Math.min(1, dt * 12));
    if (this.viewmodel.children[0]) {
      const g = this.viewmodel.children[0] as THREE.Group;
      g.rotation.x = this.viewPunchX * 0.45;
      g.rotation.y = this.viewPunchY * 0.3;
      if (w.scoped) g.position.set(0, 0, 0);
    }

    // 枪口闪光衰减
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 14);
    this.flashSprite.visible = this.muzzleFlash > 0;
    this.flashSprite.material.opacity = this.muzzleFlash;
    this.flashLight.intensity = this.muzzleFlash * 2;
    const mo = muzzleOffset(this.currentId);
    this.flashSprite.position.copy(mo);
    this.flashLight.position.copy(mo);
  }

  showMuzzle() {
    this.muzzleFlash = 1;
  }

  applyRecoil(kickPitch: number, kickYaw: number) {
    this.viewPunchX += kickPitch;
    this.viewPunchY += kickYaw;
  }

  applyDamage(dmg: number) {
    if (!this.alive) return;
    if (this.god) return;
    this.health -= dmg;
    sfx.play('hurt');
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deaths++;
      sfx.play('death');
    }
  }

  shoot(cameraDir: THREE.Vector3): { fired: boolean; dir: THREE.Vector3 } {
    const w = this.weapon;
    const hSpeed = Math.hypot(this.move.vel.x, this.move.vel.z);
    const movingFrac = Math.min(1, hSpeed / w.def.moveSpeed);
    const out = { dir: new THREE.Vector3() };
    const fired = w.fire(cameraDir, movingFrac, !this.move.onGround, out);
    if (fired) {
      if (w.isKnife) sfx.play('shot_pistol');
      else if (w.def.id === 'awp') sfx.play('shot_awp');
      else if (w.def.slot === 'secondary') sfx.play('shot_pistol');
      else sfx.play('shot_rifle');
      this.showMuzzle();
      this.applyRecoil(w.kickPitch, w.kickYaw);
    } else if (!w.reloading && !w.isKnife && w.ammoInMag <= 0 && w.fireT <= 0) {
      sfx.play('shot_empty');
    }
    return { fired, dir: out.dir };
  }

  get eyePosition(): THREE.Vector3 {
    return this.camera.position.clone();
  }
}

function createMuzzleTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,220,1)');
  grad.addColorStop(0.4, 'rgba(255,200,80,0.8)');
  grad.addColorStop(1, 'rgba(255,120,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
