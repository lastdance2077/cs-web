import * as THREE from 'three';
import { FEEL } from './config';

export interface Brush {
  min: [number, number, number];
  max: [number, number, number];
}

const _wish = new THREE.Vector3();

/**
 * Source 引擎风格的移动控制器，玩家和 Bot 共用。
 * pos 是脚底中心点（y=0 为地面）。
 */
export class MovementController {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  onGround = false;
  ducking = false;
  height = FEEL.playerHeight;

  constructor(private brushes: Brush[]) {}

  get half() {
    return FEEL.playerWidth / 2;
  }

  reset(pos: THREE.Vector3) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.onGround = false;
    this.ducking = false;
    this.height = FEEL.playerHeight;
  }

  /**
   * @param wishX / wishZ 归一化方向（0 表示无输入）
   * @param jump 是否起跳
   * @param duck 是否蹲下
   * @param walk 是否静步
   */
  update(dt: number, wishX: number, wishZ: number, jump: boolean, duck: boolean, walk: boolean, maxSpeedOverride?: number) {
    this.ducking = duck;
    const targetHeight = duck ? FEEL.playerDuckHeight : FEEL.playerHeight;
    // 蹲下/站起平滑过渡
    this.height += (targetHeight - this.height) * Math.min(1, dt * 12);

    const maxSpeed = duck ? FEEL.crouchSpeed : walk ? FEEL.walkShiftSpeed : (maxSpeedOverride ?? FEEL.walkSpeed);
    _wish.set(wishX, 0, wishZ);
    const wishLen = _wish.length();
    if (wishLen > 0.001) _wish.divideScalar(wishLen);

    if (this.onGround) {
      this.accelerate(_wish, maxSpeed, FEEL.accel, dt);
      this.applyFriction(dt);
    } else {
      this.accelerate(_wish, FEEL.airMaxSpeed, FEEL.airAccel, dt);
      this.vel.y -= FEEL.gravity * dt;
    }

    if (jump && this.onGround) {
      this.vel.y = FEEL.jumpImpulse;
      this.onGround = false;
    }

    this.moveWithCollisions(dt);
  }

  private accelerate(wish: THREE.Vector3, maxSpeed: number, accel: number, dt: number) {
    const wishSpeed = wish.length();
    if (wishSpeed < 0.001) return;
    let addSpeed = maxSpeed - this.vel.dot(wish);
    if (addSpeed <= 0) return;
    const accelSpeed = accel * maxSpeed * dt;
    if (accelSpeed < addSpeed) addSpeed = accelSpeed;
    this.vel.addScaledVector(wish, addSpeed);
  }

  private applyFriction(dt: number) {
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < 0.1) {
      this.vel.x = 0;
      this.vel.z = 0;
      return;
    }
    const control = Math.max(speed, FEEL.stopSpeed);
    let drop = control * FEEL.friction * dt;
    let newSpeed = speed - drop;
    if (newSpeed < 0) newSpeed = 0;
    const scale = newSpeed / speed;
    this.vel.x *= scale;
    this.vel.z *= scale;
  }

  private moveWithCollisions(dt: number) {
    const hw = this.half;
    const h = this.height;

    for (const axis of ['x', 'z', 'y'] as const) {
      const prev = this.pos[axis];
      this.pos[axis] += this.vel[axis] * dt;
      for (const b of this.brushes) {
        const [bminx, bminy, bminz] = b.min;
        const [bmaxx, bmaxy, bmaxz] = b.max;
        const px = this.pos.x, py = this.pos.y, pz = this.pos.z;
        if (axis === 'y') {
          // 竖直方向：只有水平投影重叠时才可能落地/撞头，
          // 且必须是脚底真正“穿过”该面（跨越检测），下落过程不会被瞬移回地面
          if (
            px + hw > bminx && px - hw < bmaxx &&
            pz + hw > bminz && pz - hw < bmaxz
          ) {
            if (this.vel.y < 0 && prev >= bmaxy - 0.5 && this.pos.y <= bmaxy + 0.5) {
              this.pos.y = bmaxy;
              this.vel.y = 0;
            } else if (this.vel.y > 0 && prev + h <= bminy + 0.5 && this.pos.y + h >= bminy - 0.5) {
              this.pos.y = bminy - h;
              this.vel.y = 0;
            }
          }
        } else if (
          px + hw > bminx && px - hw < bmaxx &&
          py + h > bminy && py < bmaxy &&
          pz + hw > bminz && pz - hw < bmaxz
        ) {
          if (axis === 'x' && this.vel.x > 0) {
            this.pos.x = bminx - hw;
            this.vel.x = 0;
          } else if (axis === 'x' && this.vel.x < 0) {
            this.pos.x = bmaxx + hw;
            this.vel.x = 0;
          } else if (axis === 'z' && this.vel.z > 0) {
            this.pos.z = bminz - hw;
            this.vel.z = 0;
          } else if (axis === 'z' && this.vel.z < 0) {
            this.pos.z = bmaxz + hw;
            this.vel.z = 0;
          }
        }
      }
    }

    // 落地检测：脚底贴着某个碰撞面顶面（含正好站在地面 y=0 的情况）
    let grounded = false;
    const eps = 0.5;
    for (const b of this.brushes) {
      if (
        this.pos.y >= b.max[1] - eps &&
        this.pos.y <= b.max[1] + eps &&
        this.pos.x + hw > b.min[0] &&
        this.pos.x - hw < b.max[0] &&
        this.pos.z + hw > b.min[2] &&
        this.pos.z - hw < b.max[2]
      ) {
        grounded = true;
        this.pos.y = b.max[1];
        break;
      }
    }
    this.onGround = grounded;

    // 防止掉出地图
    if (this.pos.y < -200) {
      this.pos.y = 0;
      this.vel.set(0, 0, 0);
      this.onGround = true;
    }
  }

  /** 射线 vs 世界（用于视线和子弹，返回命中距离，Infinity 表示未命中） */
  static raycastBrushes(brushes: Brush[], origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let best = maxDist;
    for (const b of brushes) {
      const [bminx, bminy, bminz] = b.min;
      const [bmaxx, bmaxy, bmaxz] = b.max;
      let tmin = 0, tmax = Infinity;
      const ox = origin.x, oy = origin.y, oz = origin.z;
      const dx = dir.x, dy = dir.y, dz = dir.z;
      // X slab
      if (Math.abs(dx) < 1e-8) {
        if (ox < bminx || ox > bmaxx) continue;
      } else {
        let t1 = (bminx - ox) / dx, t2 = (bmaxx - ox) / dx;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Y slab
      if (Math.abs(dy) < 1e-8) {
        if (oy < bminy || oy > bmaxy) continue;
      } else {
        let t1 = (bminy - oy) / dy, t2 = (bmaxy - oy) / dy;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Z slab
      if (Math.abs(dz) < 1e-8) {
        if (oz < bminz || oz > bmaxz) continue;
      } else {
        let t1 = (bminz - oz) / dz, t2 = (bmaxz - oz) / dz;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      if (tmin >= 0 && tmin < best) best = tmin;
    }
    return best;
  }
}
