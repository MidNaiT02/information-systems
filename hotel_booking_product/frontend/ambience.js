/*
 * Beat-reactive page-wide particle field and left-to-right travelling soundwave.
 *
 * The local MP3 player publishes normalized Web Audio metrics through
 * window.hotelAmbientAudioFrame(). This file never reads Spotify playback.
 * GTA/Cyberpunk respond with short beat bursts; Official reacts softly to
 * RMS amplitude; Daltonism uses slow, smoothed geometric breathing only.
 * A left-to-right travelling waveform appears only during active local MP3
 * playback and remains behind all page content.
 */
(() => {
  'use strict';

  const canvas = document.getElementById('ambience-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const pageTheme = document.documentElement.dataset.theme || 'cyberpunk';
  const theme = ['gta', 'cyberpunk', 'official', 'accessible'].includes(pageTheme) ? pageTheme : 'cyberpunk';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const STORAGE_KEY = 'hotel-ambient-motion-v1';
  const particles = [];
  const metrics = { playing: false, bass: 0, mid: 0, treble: 0, rms: 0, beatHit: false, highHit: false, pulse: 0 };
  let width = 0, height = 0, frame = 0, running = false, dpr = 1;
  let lastRoute = 'home';
  let ambientPulse = 0;
  let motionEnabled = true;
  let wavePhase = 0;
  let waveAmplitude = 0;
  let accessibleWaveBreath = 0;
  let waveFronts = [];

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    motionEnabled = saved == null ? !reduceMotion.matches : saved === 'true';
  } catch (_error) {
    motionEnabled = !reduceMotion.matches;
  }
  if (reduceMotion.matches) motionEnabled = false;

  const COLORS = {
    gta: ['#FF2E88', '#FF6B4A', '#FFA24C', '#F7F3EC'],
    cyberpunk: ['#00FFFF', '#FF00FF', '#FFFF00', '#DDFBFF'],
    official: ['#D4AF37', '#E8D79B', '#F5EBD0', '#FFFFFF'],
    accessible: ['#1E3A8A', '#EA580C']
  };

  function currentProfile() {
    const root = document.documentElement;
    const tier = root.dataset.loyalty || 'None';
    let count = theme === 'gta' ? 46 : theme === 'cyberpunk' ? 54 : theme === 'official' ? 24 : 12;
    if (theme === 'accessible') count = 12;
    return { theme, tier, count, colors: COLORS[theme] };
  }

  function canAnimate() {
    return !reduceMotion.matches && motionEnabled;
  }

  function saveMotionPreference() {
    try { localStorage.setItem(STORAGE_KEY, String(motionEnabled)); } catch (_error) { /* storage may be disabled */ }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, theme === 'accessible' ? 1.25 : 1.6);
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function makeParticle(fromBeat = false, routeHint = lastRoute, index = particles.length) {
    const p = currentProfile();
    const accessible = p.theme === 'accessible';
    const official = p.theme === 'official';
    const gta = p.theme === 'gta';
    const cyber = p.theme === 'cyberpunk';
    const shape = accessible ? (index % 3 === 0 ? 'square' : index % 3 === 1 ? 'circle' : 'diamond') : 'circle';
    // Accessible positions are deterministic, evenly distributed and low-density.
    const x = accessible
      ? width * (((index * 0.61803398875) + 0.12) % 1)
      : fromBeat ? width * (0.18 + Math.random() * 0.64) : Math.random() * width;
    const y = accessible
      ? height * (0.18 + (((index * 0.41421356237) + 0.1) % 0.68))
      : fromBeat ? (gta ? height * (0.62 + Math.random() * 0.3) : height * (0.16 + Math.random() * 0.68)) : Math.random() * height;
    const angle = fromBeat
      ? Math.random() * Math.PI * 2
      : gta ? -1.02 + (Math.random() - 0.5) * 0.34
        : cyber ? (Math.random() > 0.5 ? 0.02 : Math.PI)
          : -1.15 + (Math.random() - 0.5) * 0.24;
    const baseSpeed = accessible ? 0.12 : official ? 0.16 : gta ? 0.55 : 0.72;
    const speed = fromBeat ? (gta ? 1.0 : 1.3) + Math.random() * (gta ? 1.4 : 2.3) : baseSpeed * (0.3 + Math.random() * 0.8);
    const palette = p.colors;
    const particle = {
      x, y,
      vx: accessible ? (index % 2 ? 0.026 : -0.026) : Math.cos(angle) * speed + (Math.random() - 0.5) * (cyber ? 0.65 : 0.16),
      vy: accessible ? ((index % 3) - 1) * 0.018 : Math.sin(angle) * speed + (gta ? -0.22 : 0),
      baseSize: accessible ? 7 + (index % 3) * 1.5 : official ? 2.2 + Math.random() * 3.8 : gta ? 1.6 + Math.random() * 2.8 : 1.6 + Math.random() * 3.8,
      size: 2,
      alpha: accessible ? 0.82 : official ? 0.18 + Math.random() * 0.25 : 0.28 + Math.random() * 0.55,
      phase: (index * 1.7) % (Math.PI * 2),
      color: palette[index % palette.length],
      shape,
      glitch: cyber && fromBeat,
      life: fromBeat ? (gta ? 44 + Math.random() * 40 : 22 + Math.random() * 34) : Infinity,
      beatParticle: fromBeat,
      gridTargetX: x,
      gridTargetY: y,
      drift: accessible ? 0.018 : official ? 0.05 : 0.1
    };
    particle.size = particle.baseSize;
    return particle;
  }

  function seed() {
    particles.length = 0;
    const p = currentProfile();
    for (let i = 0; i < p.count; i++) particles.push(makeParticle(false, lastRoute, i));
    draw(true);
  }

  function polygon(x, y, r, sides, rotation = 0) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rotation + (Math.PI * 2 * i / sides);
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function paint(p, style, pulse, staticFrame = false) {
    if (style.theme === 'gta') {
      const scale = 1 + pulse * 0.92;
      ctx.globalAlpha = Math.min(1, p.alpha + pulse * 0.32);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, p.baseSize * (0.8 + pulse * 0.8));
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 7 + pulse * 24;
      if (p.beatParticle) {
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 7, p.y - p.vy * 7); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.baseSize * scale, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      return;
    }

    if (style.theme === 'cyberpunk') {
      const gridSnap = p.glitch && pulse > 0.12;
      const px = gridSnap ? Math.round(p.x / 18) * 18 : p.x;
      const py = gridSnap ? Math.round(p.y / 18) * 18 : p.y;
      const jitter = !staticFrame && p.glitch ? (Math.random() - 0.5) * (3 + pulse * 12) : 0;
      const w = p.glitch ? p.baseSize * (2.2 + pulse * 2.8) : p.baseSize * 1.45;
      const h = p.glitch ? Math.max(2, p.baseSize * 0.65) : p.baseSize * 1.35;
      ctx.globalAlpha = Math.min(1, p.alpha + pulse * 0.35);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 7 + pulse * 20;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(px + jitter), Math.round(py - jitter), w, h);
      ctx.shadowBlur = 0;
      if (!staticFrame && pulse > 0.12) {
        ctx.globalAlpha *= 0.48;
        ctx.fillRect(px - 12 - pulse * 14, py + h + 3, w * 2.1, 1.5);
      }
      return;
    }

    if (style.theme === 'official') {
      const swell = 1 + pulse * 0.19;
      ctx.globalAlpha = Math.min(0.58, p.alpha + pulse * 0.16);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.baseSize * (2.5 + pulse * 2);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.baseSize * swell, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      return;
    }

    // Daltonism: large, outlined blue/orange geometry; never communicates state by color alone.
    const swell = 1 + pulse * 0.065;
    const radius = p.baseSize * swell;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = p.color;
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    if (p.shape === 'square') ctx.beginPath(), ctx.rect(p.x - radius, p.y - radius, radius * 2, radius * 2);
    else if (p.shape === 'diamond') polygon(p.x, p.y, radius * 1.25, 4, Math.PI / 4);
    else ctx.beginPath(), ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }

  function updateParticle(p, style, pulse, dt) {
    const audioPlaying = metrics.playing && canAnimate();
    if (!audioPlaying) return;
    const gta = style.theme === 'gta';
    const cyber = style.theme === 'cyberpunk';
    const official = style.theme === 'official';
    const accessible = style.theme === 'accessible';
    const beatBoost = metrics.beatHit ? 1 : 0;
    const speedBoost = official ? 1 + metrics.rms * 0.35 : 1 + pulse * (accessible ? 0.05 : 0.38);
    const step = Math.min(2, dt / 16.67);

    if (gta) {
      p.x += p.vx * speedBoost * step;
      p.y += (p.vy - 0.10 - metrics.bass * 0.14) * step;
    } else if (cyber) {
      p.x += p.vx * (1 + metrics.treble * 0.7) * step;
      p.y += p.vy * step;
      if (p.glitch && pulse > 0.15) {
        const snap = 18;
        p.x += (Math.round(p.gridTargetX / snap) * snap - p.x) * 0.035;
        p.y += (Math.round(p.gridTargetY / snap) * snap - p.y) * 0.035;
      }
    } else if (official) {
      p.x += p.vx * (1 + metrics.rms * 0.25) * step;
      p.y += p.vy * (1 + metrics.rms * 0.25) * step;
    } else if (accessible) {
      // Slow, regular drift; music input is heavily smoothed below.
      p.x += p.vx * 0.24 * step;
      p.y += p.vy * 0.24 * step;
    }

    p.phase += (accessible ? 0.006 : official ? 0.012 : cyber ? 0.07 : 0.025) * step;
    if (p.life !== Infinity) p.life -= step;
    if (p.x < -24) p.x = width + 18;
    if (p.x > width + 24) p.x = -18;
    if (p.y < -24) p.y = height + 18;
    if (p.y > height + 24) p.y = -18;
  }

  function emitBeatEffects(detail = {}) {
    if (!canAnimate() || !metrics.playing) return;
    const p = currentProfile();
    if (theme === 'gta') {
      // Bass kick: short outward pulse of sunset dust, capped to avoid overdraw.
      const amount = Math.round(5 + Math.min(9, (detail.bass || 0) * 12));
      const centerX = width * (0.28 + Math.random() * 0.44);
      const centerY = height * (0.56 + Math.random() * 0.3);
      for (let i = 0; i < amount; i++) {
        const particle = makeParticle(true, lastRoute, particles.length + i);
        const angle = (Math.PI * 2 * i) / amount + Math.random() * 0.3;
        const speed = 1.2 + Math.random() * 2.2 + (detail.bass || 0) * 1.8;
        particle.x = centerX; particle.y = centerY;
        particle.vx = Math.cos(angle) * speed; particle.vy = Math.sin(angle) * speed;
        particle.baseSize = 2 + Math.random() * 2.6; particle.life = 25 + Math.random() * 24;
        particles.push(particle);
      }
    } else if (theme === 'cyberpunk' && detail.highHit) {
      // Snare/hi-hat transient: grid-snapped fragments and horizontal data tears.
      const amount = 5 + Math.round(Math.min(7, (detail.treble || 0) * 10));
      for (let i = 0; i < amount; i++) {
        const particle = makeParticle(true, lastRoute, particles.length + i);
        particle.x = Math.round((Math.random() * width) / 18) * 18;
        particle.y = Math.round((Math.random() * height) / 18) * 18;
        particle.vx = (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random() * 6);
        particle.vy = (Math.random() - 0.5) * 0.7;
        particle.glitch = true; particle.life = 13 + Math.random() * 18;
        particles.push(particle);
      }
    }
    const cap = theme === 'cyberpunk' ? 130 : theme === 'gta' ? 110 : 40;
    if (particles.length > cap) particles.splice(0, particles.length - cap);
  }


  // Beat-triggered wave markers start at the left edge and travel to the right.
  // These markers are separate from the continuous waveform phase below.
  function addWaveFront(strength = 0.5, source = 'bass') {
    if (theme === 'accessible' || theme === 'official') return;
    waveFronts.push({ x: -18, strength: Math.max(0.12, Math.min(1, strength)), source });
    if (waveFronts.length > 8) waveFronts.shift();
  }

  function drawTravelingWaves(style, pulse, staticFrame, dt) {
    // Do not render any soundwave before playback, or after pause/stop.
    if (!metrics.playing) {
      waveAmplitude = 0;
      waveFronts = [];
      return;
    }

    const moving = !staticFrame && canAnimate();
    const centerY = height * (theme === 'gta' ? 0.59 : theme === 'official' ? 0.62 : 0.54);
    let targetAmplitude = 0;
    if (theme === 'gta') targetAmplitude = 5 + metrics.bass * 44 + pulse * 17;
    else if (theme === 'cyberpunk') targetAmplitude = 4 + metrics.treble * 30 + metrics.bass * 12 + pulse * 13;
    else if (theme === 'official') targetAmplitude = 2 + metrics.rms * 16 + metrics.bass * 3;
    else targetAmplitude = 3 + metrics.rms * 10 + metrics.bass * 2;

    const amplitudeSmoothing = theme === 'accessible' ? 0.018 : theme === 'official' ? 0.055 : 0.15;
    waveAmplitude += (targetAmplitude - waveAmplitude) * amplitudeSmoothing;

    if (moving) {
      // Increasing phase in sin(x / wavelength - phase) makes each crest
      // travel from the left side toward the right side of the viewport.
      const phaseSpeed = theme === 'gta' ? 4.4 + metrics.bass * 1.5
        : theme === 'cyberpunk' ? 6.2 + metrics.treble * 2.2
          : theme === 'official' ? 1.15 + metrics.rms * 0.28 : 0.42 + metrics.rms * 0.08;
      wavePhase += dt / 1000 * phaseSpeed;
      if (theme === 'accessible') {
        accessibleWaveBreath += (Math.min(1, metrics.rms * 0.62 + metrics.bass * 0.2) - accessibleWaveBreath) * 0.012;
      }
    }

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (theme === 'accessible') {
      // Large, solid bands drift left-to-right. In reduced-motion mode the
      // phase is held still, but the graphic remains visible while audio plays.
      const bars = Math.max(12, Math.min(28, Math.floor(width / 54)));
      const gap = 9;
      const barWidth = Math.max(12, (width - gap * (bars - 1)) / bars);
      const breath = staticFrame ? 0 : accessibleWaveBreath;
      const maxHeight = 8 + breath * 12 + waveAmplitude * 0.55;
      for (let i = 0; i < bars; i++) {
        const x = i * (barWidth + gap);
        const wave = (Math.sin((x / 118) - wavePhase) + 1) / 2;
        const h = Math.max(8, 7 + wave * maxHeight);
        ctx.fillStyle = '#1E3A8A';
        ctx.fillRect(x, centerY - h / 2, barWidth, h);
      }
      ctx.restore();
      return;
    }

    const layerCount = theme === 'official' ? 1 : 3;
    for (let layer = 0; layer < layerCount; layer++) {
      const wavelength = theme === 'cyberpunk' ? 58 + layer * 12 : theme === 'gta' ? 112 + layer * 22 : 176;
      const layerAmp = waveAmplitude * (theme === 'official' ? 0.78 : 1 - layer * 0.2);
      const phaseOffset = layer * (theme === 'gta' ? 0.78 : theme === 'cyberpunk' ? 1.15 : 0);
      const color = theme === 'gta'
        ? (layer === 1 ? '#FFA24C' : layer === 2 ? '#FF6B4A' : '#FF2E88')
        : theme === 'cyberpunk'
          ? (layer % 2 ? '#FF00FF' : '#00FFFF')
          : '#D4AF37';
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, color + '00');
      gradient.addColorStop(0.12, color);
      gradient.addColorStop(0.88, color);
      gradient.addColorStop(1, color + '00');

      ctx.beginPath();
      for (let x = 0; x <= width; x += theme === 'cyberpunk' ? 3 : 2) {
        const envelope = Math.min(1, x / 54) * Math.min(1, (width - x) / 54);
        const primary = Math.sin((x / wavelength) - wavePhase + phaseOffset);
        const harmonic = theme === 'cyberpunk'
          ? Math.sin((x / 11) - wavePhase * 2.15 + phaseOffset) * metrics.treble * 0.24
          : theme === 'gta'
            ? Math.sin((x / 28) - wavePhase * 1.45 + phaseOffset) * metrics.bass * 0.12
            : 0;
        const y = centerY + (primary + harmonic) * layerAmp * envelope;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = gradient;
      ctx.lineWidth = theme === 'gta' ? 3.1 - layer * 0.55 : theme === 'cyberpunk' ? 1.9 - layer * 0.3 : 1.45;
      ctx.globalAlpha = theme === 'gta' ? 0.68 : theme === 'cyberpunk' ? 0.72 : 0.48;
      if (theme !== 'official') {
        ctx.shadowColor = color;
        ctx.shadowBlur = theme === 'gta' ? 12 + pulse * 14 : 8 + metrics.treble * 10;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Beat markers are visible only during playback and travel strictly LTR.
    for (let i = waveFronts.length - 1; i >= 0; i--) {
      const front = waveFronts[i];
      if (moving) front.x += dt * (theme === 'gta' ? 0.58 : 0.72);
      const life = Math.max(0, 1 - front.x / (width + 30));
      if (life <= 0) { waveFronts.splice(i, 1); continue; }
      const color = theme === 'gta'
        ? (front.source === 'bass' ? '#FF2E88' : '#FFA24C')
        : (front.source === 'treble' ? '#FF00FF' : '#00FFFF');
      const bandHeight = 13 + front.strength * (theme === 'gta' ? 28 : 20);
      const trailStart = Math.max(0, front.x - (theme === 'gta' ? 110 : 82));
      const trail = ctx.createLinearGradient(trailStart, 0, front.x + 3, 0);
      trail.addColorStop(0, color + '00');
      trail.addColorStop(1, color + (theme === 'gta' ? '66' : '55'));
      ctx.globalAlpha = life * 0.72;
      ctx.fillStyle = trail;
      ctx.fillRect(trailStart, centerY - bandHeight / 2, Math.max(1, front.x - trailStart), bandHeight);
      ctx.strokeStyle = color;
      ctx.lineWidth = theme === 'gta' ? 3 : 2;
      if (theme === 'gta') { ctx.shadowColor = color; ctx.shadowBlur = 11; }
      ctx.beginPath();
      ctx.moveTo(front.x, centerY - bandHeight);
      ctx.lineTo(front.x, centerY + bandHeight);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (theme === 'cyberpunk' && moving && metrics.highHit) {
      const x = Math.max(0, Math.min(width, (wavePhase * 74) % width));
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#FF00FF'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, centerY - 34); ctx.lineTo(x, centerY + 34); ctx.stroke();
    }

    // A small origin marker sits at the left edge to reinforce travel direction.
    ctx.globalAlpha = theme === 'official' ? 0.28 : 0.5;
    ctx.fillStyle = theme === 'gta' ? '#FF2E88' : theme === 'cyberpunk' ? '#00FFFF' : '#D4AF37';
    ctx.fillRect(0, centerY - 2, 3, 4);
    ctx.restore();
  }

  function draw(staticFrame = false) {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    const style = currentProfile();
    const targetPulse = !staticFrame && metrics.playing
      ? style.theme === 'official'
        ? Math.min(0.72, metrics.rms * 0.65 + metrics.bass * 0.16)
        : style.theme === 'accessible'
          ? Math.min(0.18, metrics.rms * 0.14 + metrics.bass * 0.025 + metrics.pulse * 0.035)
          : Math.max(metrics.pulse, metrics.bass * 0.35, metrics.treble * (style.theme === 'cyberpunk' ? 0.22 : 0.08))
      : 0;
    const smoothing = style.theme === 'accessible' ? (targetPulse > ambientPulse ? 0.012 : 0.025) : style.theme === 'official' ? 0.06 : 0.11;
    if (style.theme !== 'accessible') ambientPulse += (targetPulse - ambientPulse) * smoothing;
    else ambientPulse += (targetPulse - ambientPulse) * smoothing;
    const pulse = staticFrame ? 0 : ambientPulse;
    const now = performance.now();
    const dt = draw.lastTime ? Math.min(34, now - draw.lastTime) : 16.67;
    draw.lastTime = now;

    drawTravelingWaves(style, pulse, staticFrame, dt);

    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      paint(particle, style, pulse, staticFrame);
      if (!staticFrame) updateParticle(particle, style, pulse, dt);
      if (!staticFrame && particle.life <= 0) particles.splice(i, 1);
    }
    if (!staticFrame && metrics.playing && canAnimate()) {
      const desired = style.count;
      while (particles.length < desired) particles.push(makeParticle(false, lastRoute, particles.length));
    }

    if (theme === 'cyberpunk' && !staticFrame && metrics.playing && metrics.highHit && canAnimate()) {
      ctx.globalAlpha = Math.min(0.12, 0.035 + metrics.treble * 0.09);
      ctx.fillStyle = '#00FFFF';
      const y = Math.round(Math.random() * height / 16) * 16;
      ctx.fillRect(0, y, width, 1.5);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#FF00FF';
      ctx.fillRect(0, y + 2, width, 1);
    }
    ctx.globalAlpha = 1;
  }

  draw.lastTime = 0;

  function tick() {
    if (!running) return;
    if (!document.hidden) draw(false);
    frame = requestAnimationFrame(tick);
  }

  function start() {
    if (!canAnimate() || running || !metrics.playing) { draw(true); return; }
    running = true;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(frame);
    frame = 0;
    ambientPulse = 0;
    waveFronts = [];
    wavePhase = 0;
    waveAmplitude = 0;
    accessibleWaveBreath = 0;
    draw(true);
  }

  function refresh() {
    seed();
    if (canAnimate() && metrics.playing) start();
    else stop();
  }

  function setMotionEnabled(enabled) {
    motionEnabled = Boolean(enabled) && !reduceMotion.matches;
    saveMotionPreference();
    if (!motionEnabled) stop();
    else if (metrics.playing) start();
    else draw(true);
    return motionEnabled;
  }

  function publishAudioFrame(data = {}) {
    metrics.playing = Boolean(data.playing);
    metrics.bass = Math.max(0, Math.min(1, Number(data.bass) || 0));
    metrics.mid = Math.max(0, Math.min(1, Number(data.mid) || 0));
    metrics.treble = Math.max(0, Math.min(1, Number(data.treble) || 0));
    metrics.rms = Math.max(0, Math.min(1, Number(data.rms) || 0));
    metrics.pulse = Math.max(0, Math.min(1, Number(data.pulse) || 0));
    metrics.beatHit = Boolean(data.beatHit);
    metrics.highHit = Boolean(data.highHit);

    if (metrics.playing && canAnimate()) {
      if (theme === 'gta' && metrics.beatHit) addWaveFront(metrics.bass, 'bass');
      else if (theme === 'cyberpunk' && metrics.highHit) addWaveFront(metrics.treble, 'treble');
    }

    if (!metrics.playing) {
      stop();
      return;
    }
    if (!canAnimate()) {
      stop();
      return;
    }
    if ((metrics.beatHit && theme === 'gta') || (metrics.highHit && theme === 'cyberpunk')) emitBeatEffects(data);
    start();
  }

  function burst(detail = {}) {
    lastRoute = detail.route || 'home';
    if (canAnimate() && metrics.playing) emitBeatEffects({ bass: 0.35, treble: 0.25, highHit: theme === 'cyberpunk' });
    else draw(true);
  }

  window.hotelAmbientAudioFrame = publishAudioFrame;
  window.hotelAmbientSetMotion = setMotionEnabled;
  window.hotelAmbientGetMotion = () => ({ enabled: canAnimate(), systemReduced: reduceMotion.matches, theme });
  window.hotelAmbientRefresh = refresh;
  window.hotelAmbientBurst = burst;

  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && running) draw(false);
  });
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches) motionEnabled = false;
    refresh();
  });

  resize();
  draw(true);
})();
