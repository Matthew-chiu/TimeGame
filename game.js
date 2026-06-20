// ─── Constants ────────────────────────────────────────────

const DAILY_ROUNDS = 5;
const MIN_TIME     = 1;
const MAX_TIME     = 25;
const STORAGE_KEY       = 'timeit_daily';    // localStorage key for daily save data
const HOWTO_SEEN_KEY    = 'timeit_howto_seen'; // set after the modal is dismissed

// ─── Mode & round state ───────────────────────────────────

let mode             = null;  // 'daily' | 'practice'
let currentRound     = 0;
let roundScores      = [];    // { target, elapsed, diff } per round (daily only)
let dailyTargetTimes = [];    // pre-generated seeded times for today's daily

// ─── Per-round state ──────────────────────────────────────
//
// States flow: idle → countdown → active → result
// (then loops back to idle for the next round)

let state          = 'idle';
let targetTime     = 0;
let startTime      = 0;
let countdownTimer = null;

// ─── DOM references ───────────────────────────────────────

const screens = {
  home:    document.getElementById('home-screen'),
  game:    document.getElementById('game-screen'),
  results: document.getElementById('results-screen'),
};

const box            = document.getElementById('game-box');
const roundIndicator = document.getElementById('round-indicator');
const targetSection  = document.getElementById('target-section');
const targetDisplay  = document.getElementById('target-display');
const countdown      = document.getElementById('countdown');
const message        = document.getElementById('message');
const resultBlock    = document.getElementById('result-block');
const resultYourTime = document.getElementById('result-your-time');
const resultDiff     = document.getElementById('result-diff');
const gameButtons    = document.getElementById('game-buttons');
const nextBtn        = document.getElementById('next-btn');
const homeBtnGame    = document.getElementById('home-btn-game');
const clickHint      = document.getElementById('click-hint');

const roundsBody     = document.getElementById('rounds-body');
const totalValue     = document.getElementById('total-value');
const homeBtnResults = document.getElementById('home-btn-results');

// ─── Screen navigation ────────────────────────────────────

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== name);
  });
}

// ─── Helpers ──────────────────────────────────────────────

function formatSeconds(sec) {
  return sec.toFixed(2) + 's';
}

function randomTime() {
  const raw = Math.random() * (MAX_TIME - MIN_TIME) + MIN_TIME;
  return Math.round(raw * 100) / 100;
}

// Returns a grade label and CSS class based on how close the player was
function grade(diff) {
  if (diff <= 0.25) return { label: 'Excellent!',     cls: 'good' };
  if (diff <= 0.75) return { label: 'Close!',         cls: 'ok'   };
  if (diff <= 2.00) return { label: 'Not bad.',       cls: 'ok'   };
  return              { label: 'Keep practicing.', cls: 'bad'  };
}

// ─── Seeded random number generator ──────────────────────
//
// Using mulberry32 so every player gets the exact same target
// times for a given date. Seeded with YYYYMMDD as an integer.

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function todayString() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// Generates today's 5 target times — same for every player
function generateDailyTargets() {
  const seed = parseInt(todayString().replace(/-/g, ''), 10); // e.g. 20260620
  const rand = mulberry32(seed);
  return Array.from({ length: DAILY_ROUNDS }, () => {
    const raw = rand() * (MAX_TIME - MIN_TIME) + MIN_TIME;
    return Math.round(raw * 100) / 100;
  });
}

// ─── Daily save data (localStorage) ──────────────────────

function getDailySave() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveDailyResult(scores) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    date:   todayString(),
    scores: scores,
  }));
}

function hasPlayedTodaysDaily() {
  return getDailySave().date === todayString();
}

// ─── Mode entry points ────────────────────────────────────

function startDaily() {
  if (hasPlayedTodaysDaily()) {
    // Already played today — show saved results without allowing replay
    roundScores = getDailySave().scores;
    showDailyResults(true);
    return;
  }

  mode             = 'daily';
  currentRound     = 0;
  roundScores      = [];
  dailyTargetTimes = generateDailyTargets();
  showScreen('game');
  startRound();
}

function startPractice() {
  mode         = 'practice';
  currentRound = 0;
  showScreen('game');
  startRound();
}

// ─── Round lifecycle ──────────────────────────────────────

function startRound() {
  currentRound++;

  // Daily uses pre-seeded targets so all players see the same times
  targetTime = mode === 'daily'
    ? dailyTargetTimes[currentRound - 1]
    : randomTime();

  state = 'countdown';

  // Reset round UI
  gameButtons.classList.remove('show');
  resultBlock.classList.remove('show');
  box.classList.remove('active');
  clickHint.style.display = 'none';
  countdown.textContent   = '';
  message.textContent     = 'Get ready…';

  // Round indicator — only shown in daily mode
  roundIndicator.textContent = mode === 'daily'
    ? `Round ${currentRound} of ${DAILY_ROUNDS}`
    : '';

  // Reveal the target time
  targetSection.style.display = 'flex';
  targetDisplay.textContent   = formatSeconds(targetTime);

  // Count down 3 → 2 → 1, then go red
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

// Called when the player clicks during the active phase
function stopRound() {
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

  if (mode === 'daily') {
    roundScores.push({ target: targetTime, elapsed, diff });

    // Save immediately after the last round so the lock is set
    // even if the user closes before clicking "See Results"
    if (roundScores.length === DAILY_ROUNDS) {
      saveDailyResult(roundScores);
    }

    handleDailyRoundEnd();
  } else {
    handlePracticeRoundEnd();
  }
}

// ─── Post-round logic ─────────────────────────────────────

function handleDailyRoundEnd() {
  const isLastRound = currentRound === DAILY_ROUNDS;

  nextBtn.textContent       = isLastRound ? 'See Results' : 'Next Round';
  homeBtnGame.style.display = 'none'; // no bailing out mid-daily
  gameButtons.classList.add('show');

  nextBtn.onclick = isLastRound ? () => showDailyResults() : startRound;
}

function handlePracticeRoundEnd() {
  nextBtn.textContent       = 'Play Again';
  homeBtnGame.style.display = 'block';
  gameButtons.classList.add('show');

  nextBtn.onclick = startRound;
}

// ─── Daily results screen ─────────────────────────────────

function showDailyResults(alreadyPlayed = false) {
  roundsBody.innerHTML = '';
  let total = 0;

  roundScores.forEach((r, i) => {
    const sign = r.elapsed > r.target ? '+' : '-';
    const row  = document.createElement('tr');
    row.innerHTML = `
      <td>${i + 1}</td>
      <td>${formatSeconds(r.target)}</td>
      <td>${formatSeconds(r.elapsed)}</td>
      <td>${sign}${formatSeconds(r.diff)}</td>
    `;
    roundsBody.appendChild(row);
    total += r.diff;
  });

  totalValue.textContent = formatSeconds(total);

  document.getElementById('results-box').querySelector('h2').textContent =
    alreadyPlayed ? "Today's Results" : 'Daily Results';

  showScreen('results');
}

// ─── How to play modal ────────────────────────────────────

function initHowTo() {
  const overlay = document.getElementById('howto-overlay');
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

document.getElementById('daily-btn').addEventListener('click', startDaily);
document.getElementById('practice-btn').addEventListener('click', startPractice);

// stopPropagation prevents button clicks from triggering the box click
nextBtn.addEventListener('click', (e) => e.stopPropagation());
homeBtnGame.addEventListener('click', (e) => {
  e.stopPropagation();
  showScreen('home');
});

homeBtnResults.addEventListener('click', () => showScreen('home'));

// Tapping or clicking the red box stops the round.
// touch-action: manipulation in CSS handles the iOS tap delay — no touchend needed.
box.addEventListener('click', () => stopRound());
