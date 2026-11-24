/* Lightweight themed particle field. Decorative only; no pointer or keyboard interception. */
(() => {
  'use strict';
  const canvas = document.getElementById('ambience-canvas');
  if (!canvas) return;
  const pageTheme = document.documentElement.dataset.theme || 'cyberpunk';
  // Official mode stays formal and still; the accessibility mode avoids decorative motion entirely.
  if (pageTheme === 'official' || pageTheme === 'accessible') {
    canvas.hidden = true;
    canvas.setAttribute('aria-hidden', 'true');
    window.hotelAmbientRefresh = () => {};
    window.hotelAmbientBurst = () => {};
    return;
  }
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const particles = [];
  let width = 0, height = 0, frame = 0, running = false, dpr = 1;
  const tierShapes = { None: 'square', Silver: 'diamond', Gold: 'circle', Platinum: 'triangle' };
  const tierColors = {
    None: ['#8491a3', '#aeb8c5'],
    Silver: ['#72a9d4', '#c8e1f3'],
    Gold: ['#c58b32', '#f2c875'],
    Platinum: ['#65b9bd', '#b8a8ec', '#e3faff']
  };

  function profile() {
    const root = document.documentElement;
    const theme = root.dataset.theme || 'official';
    const tier = root.dataset.loyalty || 'None';
    const colors = tierColors[tier] || tierColors.None;
    let count = ({ None: 18, Silver: 24, Gold: 30, Platinum: 38 })[tier] || 18;
    if (theme === 'accessible') count = Math.min(count, 24);
    return { theme, tier, colors, count, shape: tierShapes[tier] || 'square' };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  let lastRoute = 'home';
  function makeParticle(fromBurst = false, routeHint = lastRoute) {
    const p = profile();
    const routeIndex = ['home','manage','staff'].indexOf(routeHint);
    const speed = p.theme === 'gta' ? 1.05 : p.theme === 'cyberpunk' ? 1.0 : p.theme === 'accessible' ? .42 : .34;
    // GTA particles rise like pink/orange sunrise streams; cyber particles slice sideways like data glitches.
    const angle = p.theme === 'gta' ? -1.02 + (Math.random() - .5) * .34 : p.theme === 'cyberpunk' ? (Math.random() > .5 ? .02 : Math.PI) : -1.15;
    const velocity = speed * (0.35 + Math.random() * 1.1);
    const gtaColors = ['#ff5c9a','#ff8b9d','#ffc06b','#f6a7d7','#fff0d4'];
    const cyberColors = ['#21e6f3','#ff2e88','#ffe600','#a56bff','#ffffff'];
    const palette = p.theme === 'gta' ? gtaColors : p.theme === 'cyberpunk' ? cyberColors : p.colors;
    const x = fromBurst ? width * (.12 + Math.random() * .76) : Math.random() * width;
    const y = fromBurst ? (p.theme === 'gta' ? height * (.72 + Math.random() * .25) : height * (.18 + Math.random() * .65)) : Math.random() * height;
    return {
      x, y,
      vx: Math.cos(angle) * velocity + (Math.random() - .5) * (p.theme === 'cyberpunk' ? .8 : .2),
      vy: Math.sin(angle) * velocity + (p.theme === 'gta' ? -.25 : (Math.random() - .5) * .2),
      size: p.theme === 'cyberpunk' ? 1.8 + Math.random() * 4.5 : 1.8 + Math.random() * 2.8,
      alpha: .3 + Math.random() * .58,
      phase: Math.random() * Math.PI * 2,
      color: palette[(Math.floor(Math.random() * palette.length) + Math.max(0, routeIndex)) % palette.length],
      shape: p.shape, routeIndex,
      glitch: p.theme === 'cyberpunk' && fromBurst && Math.random() > .35,
      life: fromBurst ? 34 + Math.random() * 55 : Infinity
    };
  }

  function seed() {
    particles.length = 0;
    const p = profile();
    for (let i = 0; i < p.count; i++) particles.push(makeParticle());
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

  function paintParticle(p, style, staticFrame = false) {
    const pulse = style.theme === 'cyberpunk' ? (.62 + Math.sin(p.phase) * .32) : 1;
    ctx.globalAlpha = p.alpha * pulse;
    ctx.fillStyle = p.color;
    if (style.theme === 'official') {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.size * 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 1.05, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      return;
    }
    if (style.theme === 'accessible') {
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#111827';
      if (p.shape === 'diamond') polygon(p.x, p.y, p.size + 1, 4, Math.PI / 4);
      else if (p.shape === 'triangle') polygon(p.x, p.y, p.size + 1, 3, -Math.PI / 2);
      else if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(p.x, p.y, p.size + 1, 0, Math.PI * 2); }
      else { ctx.beginPath(); ctx.rect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2); }
      ctx.fill(); ctx.stroke();
      return;
    }
    if (style.theme === 'gta') {
      // Long, soft sunset ribbons with a bright pink-orange head.
      const tail = 9 + (p.routeIndex || 0) * 3;
      ctx.strokeStyle = p.color; ctx.lineWidth = p.size * 1.15; ctx.lineCap = 'round';
      ctx.shadowColor = p.color; ctx.shadowBlur = 13;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * tail, p.y - p.vy * tail); ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha *= .82;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 1.25, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // Cyberpunk: horizontal RGB split blocks, scanlines and sharp glitch shards.
    ctx.shadowColor = p.color; ctx.shadowBlur = 10;
    const w = p.glitch ? p.size * (3 + Math.random() * 5) : p.size * 1.5;
    const h = p.glitch ? Math.max(1.5, p.size * .55) : p.size * 1.5;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), w, h);
    ctx.shadowBlur = 0;
    if (!staticFrame) {
      ctx.globalAlpha *= .5;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.vx * 5, p.y + (p.glitch ? (Math.random() - .5) * 9 : 0), w * 1.8, 1.2);
      if (p.glitch) { ctx.globalAlpha *= .55; ctx.fillRect(p.x + 8, p.y - 5, w * .65, 2); }
    }
  }

  function draw(staticFrame = false) {
    if (!width || !height) return;
    ctx.clearRect(0, 0, width, height);
    const style = profile();
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      paintParticle(p, style, staticFrame);
      if (staticFrame) continue;
      p.x += p.vx; p.y += p.vy; p.phase += style.theme === 'cyberpunk' ? .11 : .025;
      if (p.life !== Infinity) p.life--;
      if (style.theme === 'gta') p.vy += .002;
      if (p.x < -20) p.x = width + 10;
      if (p.x > width + 20) p.x = -10;
      if (p.y < -20) p.y = height + 10;
      if (p.y > height + 20) p.y = -10;
      if (p.life <= 0) particles.splice(i, 1);
    }
    ctx.globalAlpha = 1;
  }

  function tick() {
    if (!running) return;
    if (!document.hidden) draw(false);
    frame = requestAnimationFrame(tick);
  }
  function start() {
    if (reduceMotion.matches || running) { draw(true); return; }
    running = true;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
  }
  function refresh() { seed(); if (reduceMotion.matches) { running = false; cancelAnimationFrame(frame); draw(true); } else start(); }
  function burst(detail = {}) {
    if (reduceMotion.matches) return;
    lastRoute = detail.route || 'home';
    const theme = profile().theme;
    const amount = theme === 'cyberpunk' ? 52 : theme === 'gta' ? 42 : theme === 'accessible' ? 18 : 28;
    for (let i = 0; i < amount; i++) particles.push(makeParticle(true, lastRoute));
    // Route-specific visual punctuation: home blooms, booking rises, staff/admin sweeps.
    if (theme === 'gta') {
      const centerX = width * (detail.route === 'manage' ? .72 : detail.route === 'staff' ? .3 : .5);
      for (let i = 0; i < 12; i++) {
        const a = Math.PI + (i / 11) * Math.PI;
        const p = makeParticle(true, lastRoute); p.x = centerX; p.y = height * .9;
        p.vx = Math.cos(a) * (1.2 + Math.random() * 1.5); p.vy = Math.sin(a) * (1.3 + Math.random() * 1.8);
        particles.push(p);
      }
    }
    if (theme === 'cyberpunk') {
      for (let i = 0; i < 8; i++) {
        const p = makeParticle(true, lastRoute); p.x = Math.random() * width;
        p.y = height * (.15 + Math.random() * .7); p.vx = (Math.random() > .5 ? 1 : -1) * (4 + Math.random() * 8);
        p.vy = (Math.random() - .5) * .3; p.glitch = true; p.size = 3 + Math.random() * 5;
        particles.push(p);
      }
    }
  }

  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && running) draw(false); });
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', refresh);
  window.hotelAmbientRefresh = refresh;
  window.hotelAmbientBurst = burst;
  resize(); start();
})();
