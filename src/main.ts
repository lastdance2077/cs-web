import './style.css';
import { Game } from './game';
import { MAP_LIST } from './maps';
import { BOT_DIFFICULTY, DIFFICULTY_KEYS, type DifficultyKey, type Team } from './config';
import { sfx } from './audio';

const app = document.getElementById('app')!;
let game: Game | null = null;
let canvas: HTMLCanvasElement | null = null;

let selMap = MAP_LIST[0].id;
let selDiff: DifficultyKey = 'normal';
let selTeam: Team | 'random' = 'random';

function buildMenu() {
  app.innerHTML = `
    <div id="menu">
      <h1 class="title">CS:WEB</h1>
      <p class="subtitle">网页版 5v5 爆破模式 · 单人 + AI</p>

      <div class="menu-section">
        <h2>选择地图</h2>
        <div class="map-grid">
          ${MAP_LIST.map(
            (m) => `
            <div class="map-card ${m.id === selMap ? 'selected' : ''}" data-map="${m.id}">
              <div class="map-name">${m.name}</div>
              <div class="map-desc">${m.desc}</div>
            </div>`,
          ).join('')}
        </div>
      </div>

      <div class="menu-section">
        <h2>人机难度</h2>
        <div class="row">
          ${DIFFICULTY_KEYS.map(
            (k) => `
            <div class="opt-btn ${k === selDiff ? 'selected' : ''}" data-diff="${k}">
              <div class="opt-name">${BOT_DIFFICULTY[k].label}</div>
              <div class="opt-desc">${BOT_DIFFICULTY[k].desc}</div>
            </div>`,
          ).join('')}
        </div>
      </div>

      <div class="menu-section">
        <h2>你的阵营</h2>
        <div class="row">
          ${(['T', 'CT', 'random'] as const)
            .map(
              (t) => `
              <div class="opt-btn ${t === selTeam ? 'selected' : ''}" data-team="${t}">
                <div class="opt-name">${t === 'T' ? '恐怖分子 T' : t === 'CT' ? '反恐精英 CT' : '随机'}</div>
              </div>`,
            )
            .join('')}
        </div>
      </div>

      <button id="start-btn">开始游戏</button>

      <div class="menu-section help">
        <h2>操作说明</h2>
        <p>WASD 移动 · 鼠标 瞄准 · 左键 开火 · 右键 开镜 · R 换弹</p>
        <p>Shift 静步 · Ctrl 蹲下 · 空格 跳跃 · 1/2/3 切换武器 · 滚轮 换枪</p>
        <p>E 安装/拆除炸弹 · B 购买菜单 · Tab 计分板 · M 静音 · Esc 暂停</p>
        <p class="hint">玩法提示：开局在出生点按 B 买枪；AK 爆头一发必杀，M4 打有甲爆头不死，压枪才能打准</p>
      </div>
    </div>
  `;

  app.querySelectorAll<HTMLElement>('.map-card').forEach((el) => {
    el.addEventListener('click', () => {
      selMap = el.dataset.map!;
      app.querySelectorAll('.map-card').forEach((o) => o.classList.toggle('selected', o === el));
    });
  });
  app.querySelectorAll<HTMLElement>('.opt-btn[data-diff]').forEach((el) => {
    el.addEventListener('click', () => {
      selDiff = el.dataset.diff as DifficultyKey;
      app.querySelectorAll('[data-diff]').forEach((o) => o.classList.toggle('selected', o === el));
    });
  });
  app.querySelectorAll<HTMLElement>('.opt-btn[data-team]').forEach((el) => {
    el.addEventListener('click', () => {
      selTeam = el.dataset.team as Team | 'random';
      app.querySelectorAll('[data-team]').forEach((o) => o.classList.toggle('selected', o === el));
    });
  });
  app.querySelector<HTMLButtonElement>('#start-btn')!.addEventListener('click', startGame);
}

function startGame() {
  sfx.ensure();
  app.style.display = 'none';
  canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  document.body.appendChild(canvas);
  game = new Game(
    canvas,
    { mapId: selMap, difficulty: selDiff, team: selTeam },
    () => {
      game?.dispose();
      game = null;
      canvas?.remove();
      canvas = null;
      app.style.display = 'flex';
      buildMenu();
    },
    () => {
      // 再来一局：用当前选择直接重开
      game?.dispose();
      game = null;
      canvas?.remove();
      canvas = null;
      startGame();
    },
  );
}

buildMenu();

// 支持 URL 参数直达对局：?map=nuke&diff=hard&team=T
const q = new URLSearchParams(window.location.search);
const qMap = MAP_LIST.find((m) => m.id === q.get('map'))?.id;
const qDiff = DIFFICULTY_KEYS.find((d) => d === q.get('diff'));
const qTeam = (['T', 'CT', 'random'] as const).find((t) => t === q.get('team'));
if (qMap) selMap = qMap;
if (qDiff) selDiff = qDiff;
if (qTeam) selTeam = qTeam;
if (qMap || qDiff || qTeam) {
  startGame();
}
