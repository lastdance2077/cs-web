import * as THREE from 'three';
import type { Brush } from './movement';
import { FEEL } from './config';

export type NadeType = 'he' | 'flash' | 'smoke' | 'molotov';

export interface NadeDef {
  id: NadeType;
  name: string;
  price: number;
  max: number;
  fuse: number;
  cookable: boolean;
  radius: number;
}

export const NADES: Record<NadeType, NadeDef> = {
  he: { id: 'he', name: '高爆手雷', price: 300, max: 1, fuse: 1.6, cookable: true, radius: 460 },
  flash: { id: 'flash', name: '闪光弹', price: 200, max: 2, fuse: 1.6, cookable: true, radius: 900 },
  smoke: { id: 'smoke', name: '烟雾弹', price: 300, max: 1, fuse: 1.5, cookable: false, radius: 360 },
  molotov: { id: 'molotov', name: '燃烧瓶', price: 400, max: 1, fuse: 0, cookable: false, radius: 260 },
};

export const NADE_TYPES = Object.keys(NADES) as NadeType[];

export interface Detonation {
  type: NadeType;
  pos: THREE.Vector3;
  team: 'T' | 'CT';
  owner: string;
}

const R = 5; // 投掷物碰撞半径
const BOUNCE = 0.38; // 墙面反弹系数
const THROW_SPEED = 780;

/**
 * 投掷物飞行物理：重力 + 撞墙反弹 + 地面摩擦。
 * 引爆条件：HE/闪光 在保险期后撞到表面或引信到点；烟雾撞到表面或空爆；燃烧瓶一撞就着。
 */
export class NadeProjectile {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  life = 0;
  stopped = false;
  private armed = false;
  private detonated = false;
  private fuse: number;
  private hitSurface = false;

  constructor(
    public type: NadeType,
    public team: 'T' | 'CT',
    public owner: string,
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    carryVel: THREE.Vector3,
    cook = 0,
  ) {
    this.pos.copy(origin).addScaledVector(dir, 30);
    const d = NADES[type];
    // 蓄力引信：HE/闪光 按住越久，出手后越早爆
    this.fuse = Math.max(0.35, d.fuse - cook);
    this.vel.copy(carryVel).multiplyScalar(0.35).addScaledVector(dir, THROW_SPEED);
    this.vel.y += type === 'molotov' ? 120 : 90;
  }

  update(dt: number, brushes: Brush[]): Detonation | null {
    if (this.detonated) return null;
    this.life += dt;
    this.vel.y -= FEEL.gravity * dt;
    if (!this.stopped) {
      this.moveWithCollisions(dt, brushes);
      // 地面摩擦
      if (this.onGround()) {
        const s = Math.hypot(this.vel.x, this.vel.z);
        if (s > 8) {
          const k = Math.max(0, 1 - 2.6 * dt);
          this.vel.x *= k;
          this.vel.z *= k;
        } else if (Math.abs(this.vel.y) < 1) {
          this.stopped = true;
          this.vel.set(0, 0, 0);
        }
      }
    }
    const d = NADES[this.type];
    // 保险期：0.35 秒内不引爆（避免刚出手就炸自己）
    if (this.life > 0.35) this.armed = true;
    if (!this.armed) return null;

    if (this.type === 'molotov') {
      if (this.hitSurface || this.life > 4) return this.detonate();
      return null;
    }
    if (this.type === 'smoke') {
      if (this.hitSurface || this.life >= d.fuse) return this.detonate();
      return null;
    }
    // HE / 闪光：撞到表面（引信已走）或引信到点就爆
    if ((this.hitSurface || this.life >= this.fuse) && this.life > 0.35) return this.detonate();
    return null;
  }

  private detonate(): Detonation {
    this.detonated = true;
    return { type: this.type, pos: this.pos.clone(), team: this.team, owner: this.owner };
  }

  private onGround(): boolean {
    return Math.abs(this.pos.y) < 6 && this.vel.y <= 0;
  }

  private moveWithCollisions(dt: number, brushes: Brush[]) {
    for (const axis of ['x', 'z', 'y'] as const) {
      this.pos[axis] += this.vel[axis] * dt;
      for (const b of brushes) {
        const [bminx, bminy, bminz] = b.min;
        const [bmaxx, bmaxy, bmaxz] = b.max;
        const px = this.pos.x, py = this.pos.y, pz = this.pos.z;
        const overlap =
          px + R > bminx && px - R < bmaxx &&
          py + R > bminy && py - R < bmaxy &&
          pz + R > bminz && pz - R < bmaxz;
        if (!overlap) continue;
        if (axis === 'x') {
          this.pos.x = this.vel.x > 0 ? bminx - R : bmaxx + R;
          this.vel.x = -this.vel.x * BOUNCE;
          this.hitSurface = true;
        } else if (axis === 'z') {
          this.pos.z = this.vel.z > 0 ? bminz - R : bmaxz + R;
          this.vel.z = -this.vel.z * BOUNCE;
          this.hitSurface = true;
        } else {
          if (this.vel.y < 0) {
            this.pos.y = bmaxy + R;
            this.vel.y = -this.vel.y * 0.3;
            this.hitSurface = true;
          } else if (this.vel.y > 0) {
            this.pos.y = bminy - R;
            this.vel.y = -this.vel.y * 0.3;
            this.hitSurface = true;
          }
        }
      }
    }
  }
}
