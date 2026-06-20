// ─── Game state ───────────────────────────────────────────
//
// States flow in one direction:
//   idle → countdown → active → result → idle (on Play Again)

let state = 'idle';      // current phase of the game
let targetTime = 0;      // the random time the player is trying to match
let startTime = 0;       // performance.now() timestamp when red screen appeared
let countdownTimer = null;

// ─── DOM references ───────────────────────────────────────

const box           = document.getElementById('game-box');
const countdown     = document.getElementById('countdown');
const message       = document.getElementById('message');
const playBtn       = document.getElementById('play-btn');
const targetSection = document.getElementById('target-section');
const targetDisplay = document.getElementById('target-display');
const resultBlock   = document.getElementById('result-block');
const resultYourTime = document.getElementById('result-your-time');
const resultDiff    = document.getElementById('result-diff');
const clickHint     = document.getElementById('click-hint');

// ─── Helpers ──────────────────────────────────────────────

// Returns a random number between 1.00 and 25.00 (2 decimal places)
function randomTime() {
  const raw = Math.random() * (25 - 1) + 1;
  return Math.round(raw * 100) / 100;
}

// Formats a number of seconds as "X.XXs"
function formatSeconds(sec) {
  return sec.toFixed(2) + 's';
}

// Returns a grade label and CSS class based on how close the player was
function grade(diff) {
  if (diff <= 0.25) return { label: 'Excellent!',       cls: 'good' };
  if (diff <= 0.75) return { label: 'Close!',           cls: 'ok'   };
  if (diff <= 2.00) return { label: 'Not bad.',         cls: 'ok'   };
  return              { label: 'Keep practicing.',   cls: 'bad'  };
}

// ─── Game phases ──────────────────────────────────────────

function startGame() {
  if (state === 'countdown' || state === 'active') return;

  targetTime = randomTime();
  state = 'countdown';

  // Reset UI for a new round
  playBtn.style.display    = 'none';
  clickHint.style.display  = 'none';
  resultBlock.classList.remove('show');
  box.classList.remove('active');
  message.textContent = 'Get ready…';

  // Show the target time the player is aiming for
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

// Called immediately after the countdown ends — this is when timing begins
function activateRed() {
  state = 'active';
  startTime = performance.now();
  box.classList.add('active');
  message.textContent = '';
  clickHint.style.display = 'block';
}

// Called when the player clicks during the active phase
function stopGame() {
  if (state !== 'active') return;

  const elapsed = (performance.now() - startTime) / 1000;
  state = 'result';

  box.classList.remove('active');
  clickHint.style.display = 'none';
  message.textContent = `Target was ${formatSeconds(targetTime)}`;

  const diff     = Math.abs(elapsed - targetTime);
  const sign     = elapsed > targetTime ? '+' : '-';
  const { label, cls } = grade(diff);

  resultYourTime.textContent = formatSeconds(elapsed);
  resultDiff.textContent     = `${sign}${formatSeconds(diff)} — ${label}`;
  resultDiff.className       = cls;
  resultBlock.classList.add('show');

  playBtn.textContent      = 'Play Again';
  playBtn.style.display    = 'block';
}

// ─── Event listeners ──────────────────────────────────────

// stopPropagation prevents the button click from also triggering the box click
playBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  startGame();
});

box.addEventListener('click', () => {
  stopGame();
});
