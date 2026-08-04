import * as THREE from 'three';
import { WEAPONS, type WeaponDef } from './config';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * 单把武器的状态机：射速、换弹、弹道图案、散布、后座恢复。
 */
export class WeaponSystem {
  def: WeaponDef;
  ammoInMag: number;
  reserve: number;
  reloading = false;
  reloadT = 0;
  fireT = 0;
  recoilIndex = 0;
  lastShotT = 0;
  scoped = false;
  /** 刀刃挥砍冷却 */
  swingT = 0;

  constructor(id: string) {
    this.def = WEAPONS[id];
    this.ammoInMag = this.def.magSize;
    this.reserve = this.def.reserve;
  }

  get isKnife() {
    return !!this.def.knife;
  }

  update(dt: number, moving: number, inAir: boolean) {
    this.fireT -= dt;
    this.swingT -= dt;
    if (this.reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = this.def.magSize - this.ammoInMag;
        const take = Math.min(need, this.reserve);
        this.ammoInMag += take;
        this.reserve -= take;
        this.reloading = false;
      }
    }
    const since = performance.now() / 1000 - this.lastShotT;
    if (since > 0.35) {
      this.recoilIndex = Math.max(0, this.recoilIndex - 4 * dt);
    }
    void moving;
    void inAir;
  }

  startReload() {
    if (this.reloading || this.isKnife) return;
    if (this.ammoInMag >= this.def.magSize || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadT = this.def.reloadTime;
  }

  inaccuracy(moving: number, inAir: boolean) {
    let s = this.def.spreadBase;
    if (this.scoped) s *= 0.4;
    s += moving * this.def.spreadMove;
    if (inAir) s += this.def.spreadJump;
    s += Math.min(this.recoilIndex, 20) * this.def.spreadShot;
    return Math.min(s, this.def.spreadMax);
  }

  /**
   * 开火。out.dir 会被改写为实际子弹方向（含弹道图案 + 随机散布）。
   * 返回是否真的打出了这一发。
   */
  fire(cameraDir: THREE.Vector3, moving: number, inAir: boolean, out: { dir: THREE.Vector3 }): boolean {
    if (this.isKnife) {
      if (this.swingT > 0) return false;
      this.swingT = 60 / this.def.rpm;
      out.dir.copy(cameraDir);
      return true;
    }
    if (this.fireT > 0 || this.reloading) return false;
    if (this.ammoInMag <= 0) return false;
    this.fireT = 60 / this.def.rpm;
    this.lastShotT = performance.now() / 1000;
    this.ammoInMag--;
    this.recoilIndex++;

    const pat = this.def.pattern
      ? this.def.pattern[Math.min(Math.floor(this.recoilIndex) - 1, this.def.pattern.length - 1)]
      : [0, 0];
    const spread = this.inaccuracy(moving, inAir);
    const sx = (Math.random() * 2 - 1) * spread;
    const sy = (Math.random() * 2 - 1) * spread;
    const px = pat[0] / 1000 + sx;
    const py = pat[1] / 1000 + sy;

    const right = new THREE.Vector3().crossVectors(cameraDir, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, cameraDir).normalize();
    out.dir.copy(cameraDir).addScaledVector(right, px).addScaledVector(up, py).normalize();
    return true;
  }

  get kickPitch() {
    return this.def.recoilPitch;
  }

  get kickYaw() {
    return (Math.random() * 2 - 1) * this.def.recoilYaw;
  }
}
