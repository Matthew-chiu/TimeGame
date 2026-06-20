// ─── Constants ────────────────────────────────────────────

const MIN_TIME       = 1;
const MAX_TIME       = 25;
const HOWTO_SEEN_KEY = 'timeit_howto_seen';

// ─── Game state ───────────────────────────────────────────
//
// States flow: idle → countdown → active → result → idle

let state          = 'idle';
let targetTime     = 0;
let startTime      = 0;
let countdownTimer = null;

// ─── DOM references ───────────────────────────────────────

const box            = document.getElementById('game-box');
const targetSection  = document.getElementById('target-section');
const targetDisplay  = document.getElementById('target-display');
const countdown      = document.getElementById('countdown');
const message        = document.getElementById('message');
const resultBlock    = document.getElementById('result-block');
const resultYourTime = document.getElementById('result-your-time');
const resultDiff     = document.getElementById('result-diff');
const playBtn        = document.getElementById('play-btn');
const clickHint      = document.getElementById('click-hint');

// ─── Helpers ──────────────────────────────────────────────

function randomTime() {
  const raw = Math.random() * (MAX_TIME - MIN_TIME) + MIN_TIME;
  return Math.round(raw * 100) / 100;
}

function formatSeconds(sec) {
  return sec.toFixed(2) + 's';
}

function grade(diff) {
  if (diff <= 0.25) return { label: 'Excellent!',     cls: 'good' };
  if (diff <= 0.75) return { label: 'Close!',         cls: 'ok'   };
  if (diff <= 2.00) return { label: 'Not bad.',       cls: 'ok'   };
  return              { label: 'Keep practicing.', cls: 'bad'  };
}

// ─── Game phases ──────────────────────────────────────────

function startGame() {
  if (state === 'countdown' || state === 'active') return;

  targetTime = randomTime();
  state      = 'countdown';

  playBtn.style.display   = 'none';
  clickHint.style.display = 'none';
  resultBlock.classList.remove('show');
  box.classList.remove('active');
  message.textContent = 'Get ready…';

  targetSection.style.display = 'flex';
  targetDisplay.textContent   = formatSeconds(targetTime);

  const steps = ['3', '2', '1'];
  let i = 0;
  countdown.textContent = steps[i];

  countdownTimer = setInterval(() => {
    i++;
    if (i < steps.length) {
      countdown.textContent = steps[i];
    } else {
      clearInterval(countdownTimer);
      countdown.textContent = '';
      activateRed();
    }
  }, 1000);
}

// Called immediately after the countdown — this is when timing begins
function activateRed() {
  state     = 'active';
  startTime = performance.now();
  box.classList.add('active');
  message.textContent     = '';
  clickHint.style.display = 'block';
}

// Called when the player taps/clicks during the active phase
function stopGame() {
  if (state !== 'active') return;

  const elapsed = (performance.now() - startTime) / 1000;
  const diff    = Math.abs(elapsed - targetTime);
  const sign    = elapsed > targetTime ? '+' : '-';
  state = 'result';

  box.classList.remove('active');
  clickHint.style.display = 'none';
  message.textContent     = `Target was ${formatSeconds(targetTime)}`;

  const { label, cls } = grade(diff);
  resultYourTime.textContent = formatSeconds(elapsed);
  resultDiff.textContent     = `${sign}${formatSeconds(diff)} — ${label}`;
  resultDiff.className       = cls;
  resultBlock.classList.add('show');

  playBtn.textContent   = 'Play Again';
  playBtn.style.display = 'block';
}

// ─── How to play modal ────────────────────────────────────

function initHowTo() {
  const overlay  = document.getElementById('howto-overlay');
  const closeBtn = document.getElementById('howto-close');

  if (localStorage.getItem(HOWTO_SEEN_KEY)) {
    overlay.classList.add('hidden');
    return;
  }

  closeBtn.addEventListener('click', () => {
    localStorage.setItem(HOWTO_SEEN_KEY, '1');
    overlay.classList.add('hidden');
  });
}

// ─── Event listeners ──────────────────────────────────────

initHowTo();

playBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  startGame();
});

box.addEventListener('click', () => stopGame());
