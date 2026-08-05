// =====================================================================
// 全局数值配置 —— 想调“手感”，90% 的情况改这个文件就够了。
// 单位制：1 单位 = 1 英寸风格（CS:GO 同款），速度单位/秒。
// =====================================================================

export const FEEL = {
  // ---- 移动（Source 引擎风格）----
  walkSpeed: 185, // 普通跑动速度
  walkShiftSpeed: 90, // 按住 Shift 静步
  crouchSpeed: 95, // 蹲下移动
  accel: 5.5, // 地面加速度 (sv_accelerate)
  friction: 5.2, // 地面摩擦 (sv_friction)
  stopSpeed: 100, // 低于此速度视为停止 (sv_stopspeed)
  airAccel: 12, // 空中加速度 (sv_airaccelerate)
  airMaxSpeed: 250, // 空中水平速度上限
  gravity: 800, // 重力 (sv_gravity)
  jumpImpulse: 301.99, // 起跳初速度 (sv_jump_impulse)

  // ---- 碰撞盒 ----
  playerWidth: 32, // 宽/深（半径 16）
  playerHeight: 72, // 站立高度
  playerDuckHeight: 54, // 蹲下高度
  eyeHeight: 64, // 站立眼睛高度
  duckEyeHeight: 46, // 蹲下眼睛高度

  // ---- 后座与视角 ----
  recoilRecoverDelay: 0.35, // 停火多久后开始恢复弹道
  recoilRecoverSpeed: 4.0, // 弹道恢复速度
  viewPunchRecover: 4.5, // 视角上抬回弹速度（放慢，回弹更平滑不震）
  zoomSpeed: 6.0, // 开镜过渡速度
  mouseSens: 0.0008, // 鼠标灵敏度（弧度/计数，约 CS:GO 默认量级）
};

export const MATCH = {
  winScore: 8, // 先赢 8 局获胜
  halfRounds: 8, // 打完 8 局换边
  roundTime: 115, // 回合时间（秒）
  freezeTime: 6, // 开局冻结/购买时间（秒）
  buyTime: 15, // 开局可购买时长（秒）
  bombTime: 40, // 炸弹引爆倒计时（秒）
  plantTime: 3, // 安装耗时（秒）
  defuseTime: 10, // 拆弹耗时（秒）
  kitDefuseTime: 5, // 有拆弹钳的耗时（秒）
  bombRadius: 520, // 爆炸伤害半径
  startMoney: 4000,
  killReward: 300,
  plantReward: 300,
  defuseReward: 300,
  winReward: 3250,
  bombWinReward: 3500,
  lossBonusBase: 1400,
  lossBonusStep: 500,
  lossBonusCap: 3400,
};

export type Team = 'T' | 'CT';

export interface WeaponDef {
  id: string;
  name: string;
  team: 'T' | 'CT' | 'both';
  slot: 'primary' | 'secondary' | 'melee';
  price: number;
  damage: number; // 无甲身体伤害
  headMult: number; // 爆头倍率
  armorBodyMult: number; // 有甲时身体伤害倍率
  armorHeadMult: number; // 有甲时爆头伤害倍率
  rpm: number; // 每分钟射速
  magSize: number; // 弹匣容量（-1 = 无需弹药）
  reserve: number; // 备弹
  reloadTime: number; // 换弹耗时（秒）
  auto: boolean; // 是否全自动
  spreadBase: number; // 站立静止首发散布（弧度）
  spreadMove: number; // 满速移动附加散布
  spreadJump: number; // 空中附加散布
  spreadShot: number; // 每发附加散布
  spreadMax: number; // 散布上限
  recoilPitch: number; // 每发视角上抬（弧度）
  recoilYaw: number; // 每发随机左右（弧度）
  pattern?: Array<[number, number]>; // 弹道图案：[右偏移, 上偏移]，以 1000 距离处单位计
  moveSpeed: number; // 持枪移动速度
  range: number; // 射程
  zoom?: number; // 开镜后的垂直 FOV
  knife?: boolean;
}

// AK 弹道（30 发，近似 CS:GO 先上后左右摆）
const AK_PATTERN: Array<[number, number]> = [
  [0, 0], [0, 0.8], [0, 1.8], [-0.6, 2.6], [1.2, 3.0], [2.5, 3.2], [-1.2, 3.5], [-2.5, 3.7],
  [-1.0, 4.2], [1.2, 4.6], [2.0, 4.9], [0.5, 5.3], [-1.6, 5.6], [-2.2, 5.9], [-0.6, 6.3],
  [1.4, 6.6], [2.4, 6.9], [0.9, 7.3], [-1.4, 7.6], [-2.0, 7.9], [0.3, 8.2], [1.6, 8.4],
  [-1.1, 8.7], [-2.0, 8.9], [0.8, 9.1], [1.5, 9.3], [-0.6, 9.5], [-1.4, 9.7], [0.4, 9.9], [1.2, 10.1],
];

// M4 弹道（更稳）
const M4_PATTERN: Array<[number, number]> = [
  [0, 0], [0, 0.7], [0, 1.5], [-0.5, 2.1], [1.0, 2.5], [1.8, 2.8], [-0.9, 3.0], [-1.8, 3.2],
  [-0.6, 3.6], [1.0, 3.9], [1.6, 4.1], [0.3, 4.4], [-1.2, 4.6], [-1.6, 4.8], [-0.4, 5.1],
  [1.2, 5.3], [1.8, 5.5], [0.6, 5.8], [-1.0, 6.0], [-1.5, 6.2], [0.3, 6.4], [1.3, 6.6],
  [-0.8, 6.8], [-1.4, 7.0], [0.6, 7.2], [1.2, 7.4], [-0.4, 7.6], [-1.0, 7.8], [0.3, 8.0], [0.9, 8.2],
];

export const WEAPONS: Record<string, WeaponDef> = {
  knife: {
    id: 'knife', name: '刀', team: 'both', slot: 'melee', price: 0,
    damage: 65, headMult: 1, armorBodyMult: 1, armorHeadMult: 1,
    rpm: 120, magSize: -1, reserve: 0, reloadTime: 0, auto: false,
    spreadBase: 0, spreadMove: 0, spreadJump: 0, spreadShot: 0, spreadMax: 0,
    recoilPitch: 0, recoilYaw: 0,
    moveSpeed: 210, range: 96, knife: true,
  },
  usp: {
    id: 'usp', name: 'USP 手枪', team: 'both', slot: 'secondary', price: 0,
    damage: 35, headMult: 4, armorBodyMult: 0.7, armorHeadMult: 0.71,
    rpm: 352, magSize: 12, reserve: 24, reloadTime: 2.2, auto: false,
    spreadBase: 0.004, spreadMove: 0.02, spreadJump: 0.04, spreadShot: 0.004, spreadMax: 0.05,
    recoilPitch: 0.008, recoilYaw: 0.006,
    moveSpeed: 195, range: 8192, zoom: 60,
  },
  ak: {
    id: 'ak', name: 'AK-47', team: 'T', slot: 'primary', price: 2700,
    damage: 36, headMult: 3, armorBodyMult: 0.75, armorHeadMult: 0.85,
    rpm: 600, magSize: 30, reserve: 90, reloadTime: 2.4, auto: true,
    spreadBase: 0.006, spreadMove: 0.025, spreadJump: 0.05, spreadShot: 0.004, spreadMax: 0.07,
    recoilPitch: 0.017, recoilYaw: 0.008, pattern: AK_PATTERN,
    moveSpeed: 180, range: 8192, zoom: 52,
  },
  m4: {
    id: 'm4', name: 'M4A4', team: 'CT', slot: 'primary', price: 3100,
    damage: 33, headMult: 3, armorBodyMult: 0.78, armorHeadMult: 0.82,
    rpm: 666, magSize: 30, reserve: 90, reloadTime: 2.4, auto: true,
    spreadBase: 0.005, spreadMove: 0.022, spreadJump: 0.045, spreadShot: 0.0035, spreadMax: 0.06,
    recoilPitch: 0.014, recoilYaw: 0.007, pattern: M4_PATTERN,
    moveSpeed: 180, range: 8192, zoom: 52,
  },
  awp: {
    id: 'awp', name: 'AWP', team: 'both', slot: 'primary', price: 4750,
    damage: 115, headMult: 4, armorBodyMult: 0.9, armorHeadMult: 1,
    rpm: 41, magSize: 5, reserve: 30, reloadTime: 3.5, auto: false,
    spreadBase: 0.0008, spreadMove: 0.03, spreadJump: 0.06, spreadShot: 0.02, spreadMax: 0.07,
    recoilPitch: 0.03, recoilYaw: 0.012,
    moveSpeed: 160, range: 16384, zoom: 17,
  },
};

export const WEAPON_IDS = ['knife', 'usp', 'ak', 'm4', 'awp'] as const;

// 主菜单可买列表（按槽位展示）
export const BUYABLE: Array<{ id: string; key: string }> = [
  { id: 'usp', key: '1' },
  { id: 'ak', key: '2' },
  { id: 'm4', key: '3' },
  { id: 'awp', key: '4' },
];

export interface BotDifficulty {
  label: string;
  desc: string;
  aimError: number; // 瞄准误差（弧度）
  reactionMin: number; // 反应时间范围（秒）
  reactionMax: number;
  burstMin: number; // 连发子弹数范围
  burstMax: number;
  burstPause: number; // 连发间隔停顿
  fov: number; // 视野角度（度）
  hearing: number; // 听到枪声的半径
  aimTurnSpeed: number; // 转向速度（弧度/秒）
  moveShoot: boolean; // 移动中是否开火
  aimLead: number; // 预判系数（0~1）
  hp: number; // 人机血量
  dmgMult: number; // 人机伤害倍率
}

export const BOT_DIFFICULTY: Record<'easy' | 'normal' | 'hard', BotDifficulty> = {
  easy: {
    label: '简单', desc: '反应慢、枪法歪，适合新手熟悉地图',
    aimError: 0.06, reactionMin: 0.7, reactionMax: 1.2, burstMin: 1, burstMax: 2,
    burstPause: 0.45, fov: 90, hearing: 1200, aimTurnSpeed: 3, moveShoot: false, aimLead: 0.1, hp: 100, dmgMult: 0.8,
  },
  normal: {
    label: '普通', desc: '反应和枪法接近真人',
    aimError: 0.03, reactionMin: 0.3, reactionMax: 0.55, burstMin: 3, burstMax: 5,
    burstPause: 0.28, fov: 120, hearing: 1800, aimTurnSpeed: 5, moveShoot: true, aimLead: 0.5, hp: 100, dmgMult: 1,
  },
  hard: {
    label: '困难', desc: '预瞄、连发、压枪都很快，别站桩',
    aimError: 0.015, reactionMin: 0.12, reactionMax: 0.28, burstMin: 4, burstMax: 8,
    burstPause: 0.18, fov: 150, hearing: 2800, aimTurnSpeed: 8, moveShoot: true, aimLead: 0.85, hp: 100, dmgMult: 1.1,
  },
};

export const DIFFICULTY_KEYS = ['easy', 'normal', 'hard'] as const;
export type DifficultyKey = (typeof DIFFICULTY_KEYS)[number];
