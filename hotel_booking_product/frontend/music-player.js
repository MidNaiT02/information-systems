/*
 * HOTEL MUSIC PLAYER
 * ------------------
 * Local mode streams the MP3 files supplied for this university project from
 * /music/<playlist>/<track-id>. Web Audio analyses ONLY these local files and
 * drives the style-specific visualizer in real time.
 *
 * Spotify mode uses Spotify's official Embed iFrame API. Spotify playback is
 * intentionally kept separate from the visualizer; Spotify content is not
 * analysed or synchronized with visual effects.
 *
 * Music archives are placed in /music_archives as gta.zip, cyberpunk.zip and
 * upbeat.zip. See MUSIC_SETUP.md for the one-time setup instructions.
 */
(() => {
  'use strict';

  if (document.getElementById('hotel-music-root')) return;

  const THEME = document.documentElement.dataset.theme || 'cyberpunk';
  const THEMES = {
    gta: {
      pack: 'gta', spotifyId: '359kPloDaoWnejGP6mxSi0',
      title: 'LOBBY VIBES', subtitleKey: 'subtitleGta', captionKey: 'captionGta'
    },
    cyberpunk: {
      pack: 'cyberpunk', spotifyId: '0cf3Aqb7GeyXHY4eIKFKcP',
      title: 'SYSTEM AUDIO', subtitleKey: 'subtitleCyber', captionKey: 'captionCyber'
    },
    official: {
      pack: 'upbeat', spotifyId: '37i9dQZF1EVJHK7Q1TBABQ',
      title: 'CURATED AMBIENCE', subtitleKey: 'subtitleOfficial', captionKey: 'captionOfficial'
    },
    accessible: {
      pack: 'upbeat', spotifyId: '37i9dQZF1EVJHK7Q1TBABQ',
      title: 'RELAXATION AUDIO', subtitleKey: 'subtitleAccessible', captionKey: 'captionAccessible'
    }
  };
  const theme = THEMES[THEME] ? THEME : 'cyberpunk';
  const config = THEMES[theme];
  const STRINGS = {
    kz: {
      open: 'Қонақүй музыкасы', close: 'Жабу', local: 'Жергілікті музыка', spotify: 'Spotify',
      now: 'ҚАЗІР ОЙНАП ТҰР', idle: 'ӘНДІ ТАҢДАҢЫЗ', play: 'Ойнату', pause: 'Тоқтату',
      previous: 'Алдыңғы ән', next: 'Келесі ән', shuffle: 'Кездейсоқ рет', repeat: 'Қайталау режимі',
      volume: 'Дыбыс деңгейі', mute: 'Дыбысты өшіру', unmute: 'Дыбысты қосу',
      tracks: 'Ойнату тізімі', loading: 'Жүктелуде…', paused: 'Тоқтатылды', playing: 'Ойнатылуда',
      spotifyHint: 'Spotify ресми ойнатқышы. Визуализатор жергілікті MP3 файлдарымен ғана синхрондалады.',
      localHint: 'Нақты beat-синхрондау жергілікті аудиоға қосылған.',
      missing: 'Музыка архивтері табылмады. MUSIC_SETUP.md нұсқаулығын қараңыз.',
      failed: 'Әнді ойнату мүмкін болмады. Қайта көріңіз.',
      resume: 'Музыканы жалғастыру үшін ойнату батырмасын басыңыз.',
      repeatOff: 'Қайталау өшірулі', repeatAll: 'Тізімді қайталау', repeatOne: 'Бір әнді қайталау',
      shuffleOn: 'Кездейсоқ рет қосулы', shuffleOff: 'Кездейсоқ рет өшірулі',
      noTracks: 'Бұл тізімде әндер жоқ.', player: 'Музыка ойнатқышы', source: 'Музыка көзі', seek: 'Ән ішінен орын таңдау', playlistTracks: 'Ойнату тізімі', openSpotify: 'Бұл тізімді Spotify қолданбасында ашу ↗', subtitleGta: 'VICE CITY РАДИОСЫ / ЖЕРГІЛІКТІ ӘУЕН', subtitleCyber: 'NIGHT CITY ЖИІЛІКТЕРІ / ЖЕРГІЛІКТІ ӘУЕН', subtitleOfficial: 'ҚОНАҚҮЙ МУЗЫКАСЫНЫҢ ЖИНАҒЫ', subtitleAccessible: 'ҚОЛЖЕТІМДІ МУЗЫКА ОЙНАТҚЫШЫ', captionGta: 'VICE CITY / FM 1986', captionCyber: 'ДЫБЫС СПЕКТРІ / НАҚТЫ УАҚЫТ', captionOfficial: 'ДЫБЫС ПЕН ТЫНЫШТЫҚ', captionAccessible: 'ДЫБЫС ДЕҢГЕЙІ / НАҚТЫ УАҚЫТ', motionOn: 'ҚОЗҒАЛЫС: ҚОСУЛЫ', motionOff: 'ҚОЗҒАЛЫС: ӨШІРУЛІ', motionSystemOff: 'ҚОЗҒАЛЫС: ЖҮЙЕ БОЙЫНША ӨШІРУЛІ', motionHint: 'Қозғалыс әсерлерін басқару'
    },
    en: {
      open: 'Lobby music', close: 'Close', local: 'Local music', spotify: 'Spotify',
      now: 'NOW PLAYING', idle: 'SELECT A TRACK', play: 'Play', pause: 'Pause',
      previous: 'Previous track', next: 'Next track', shuffle: 'Shuffle', repeat: 'Repeat mode',
      volume: 'Volume', mute: 'Mute', unmute: 'Unmute',
      tracks: 'Playlist', loading: 'Loading…', paused: 'Paused', playing: 'Playing',
      spotifyHint: 'Official Spotify player. Beat visualizers are available with local MP3 audio only.',
      localHint: 'Real-time beat analysis is active for local audio.',
      missing: 'Music archives are missing. See MUSIC_SETUP.md.',
      failed: 'Could not play this track. Please try again.',
      resume: 'Press Play to resume your music.',
      repeatOff: 'Repeat off', repeatAll: 'Repeat playlist', repeatOne: 'Repeat one track',
      shuffleOn: 'Shuffle on', shuffleOff: 'Shuffle off',
      noTracks: 'No tracks in this playlist.', player: 'Music player', source: 'Music source', seek: 'Seek through track', playlistTracks: 'Playlist tracks', openSpotify: 'Open this playlist on Spotify ↗', subtitleGta: 'VICE CITY RADIO / LOCAL MUSIC', subtitleCyber: 'NIGHT CITY FREQUENCIES / LOCAL MUSIC', subtitleOfficial: 'HOTEL MUSIC COLLECTION', subtitleAccessible: 'ACCESSIBLE MUSIC PLAYER', captionGta: 'VICE CITY / FM 1986', captionCyber: 'AUDIO SPECTRUM / LIVE', captionOfficial: 'SOUND & STILLNESS', captionAccessible: 'AUDIO LEVEL / LIVE', motionOn: 'MOTION: ON', motionOff: 'MOTION: OFF', motionSystemOff: 'MOTION: OFF (SYSTEM SETTING)', motionHint: 'Control background motion effects'
    },
    ru: {
      open: 'Музыка отеля', close: 'Закрыть', local: 'Локальная музыка', spotify: 'Spotify',
      now: 'СЕЙЧАС ИГРАЕТ', idle: 'ВЫБЕРИТЕ ТРЕК', play: 'Играть', pause: 'Пауза',
      previous: 'Предыдущий трек', next: 'Следующий трек', shuffle: 'Перемешать', repeat: 'Режим повтора',
      volume: 'Громкость', mute: 'Без звука', unmute: 'Включить звук',
      tracks: 'Плейлист', loading: 'Загрузка…', paused: 'Пауза', playing: 'Играет',
      spotifyHint: 'Официальный плеер Spotify. Синхронизация визуализатора доступна только для локальных MP3.',
      localHint: 'Анализ ритма в реальном времени работает для локального аудио.',
      missing: 'Музыкальные архивы не найдены. См. MUSIC_SETUP.md.',
      failed: 'Не удалось воспроизвести трек. Попробуйте ещё раз.',
      resume: 'Нажмите Play, чтобы продолжить музыку.',
      repeatOff: 'Повтор выключен', repeatAll: 'Повтор плейлиста', repeatOne: 'Повтор одного трека',
      shuffleOn: 'Перемешивание включено', shuffleOff: 'Перемешивание выключено',
      noTracks: 'В этом плейлисте нет треков.', player: 'Музыкальный плеер', source: 'Источник музыки', seek: 'Перемотка трека', playlistTracks: 'Список треков', openSpotify: 'Открыть этот плейлист в Spotify ↗', subtitleGta: 'РАДИО ВАЙС-СИТИ / ЛОКАЛЬНАЯ МУЗЫКА', subtitleCyber: 'ЧАСТОТЫ НОЧНОГО ГОРОДА / ЛОКАЛЬНАЯ МУЗЫКА', subtitleOfficial: 'МУЗЫКАЛЬНАЯ КОЛЛЕКЦИЯ ОТЕЛЯ', subtitleAccessible: 'ДОСТУПНЫЙ МУЗЫКАЛЬНЫЙ ПЛЕЕР', captionGta: 'VICE CITY / FM 1986', captionCyber: 'АУДИОСПЕКТР / В РЕАЛЬНОМ ВРЕМЕНИ', captionOfficial: 'ЗВУК И СПОКОЙСТВИЕ', captionAccessible: 'УРОВЕНЬ ЗВУКА / В РЕАЛЬНОМ ВРЕМЕНИ', motionOn: 'ДВИЖЕНИЕ: ВКЛ.', motionOff: 'ДВИЖЕНИЕ: ВЫКЛ.', motionSystemOff: 'ДВИЖЕНИЕ: ВЫКЛ. (НАСТРОЙКА СИСТЕМЫ)', motionHint: 'Управление фоновыми эффектами'
    }
  };
  const language = () => {
    const saved = localStorage.getItem('hotel-lang') || document.documentElement.dataset.defaultLang || 'kz';
    return STRINGS[saved] ? saved : 'kz';
  };
  const t = key => STRINGS[language()][key] || STRINGS.en[key] || key;
  const escapeHTML = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = value => {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };

  const root = document.createElement('div');
  root.id = 'hotel-music-root';
  root.dataset.theme = theme;
  root.dataset.afterDark = document.documentElement.dataset.afterDark || 'false';
  root.dataset.playing = 'false';
  root.dataset.source = 'local';
  root.dataset.noTranslate = '';
  root.innerHTML = `
    <button type="button" class="hm-launch" id="hm-launch" aria-expanded="false" aria-controls="hm-drawer">
      <span class="hm-launch-icon" aria-hidden="true">♫</span>
      <span class="hm-launch-label" id="hm-launch-label"></span>
      <span class="hm-launch-state" aria-hidden="true"></span>
    </button>
    <section class="hm-drawer" id="hm-drawer" aria-label="Hotel music player" hidden>
      <header class="hm-header">
        <div class="hm-brandline"><span class="hm-kicker" id="hm-kicker"></span><strong id="hm-brand-title"></strong></div>
        <button type="button" class="hm-close" id="hm-close" aria-label="Close">×</button>
      </header>
      <div class="hm-source-tabs" role="tablist" aria-label="Music source">
        <button type="button" class="hm-source-tab is-active" id="hm-tab-local" role="tab" aria-selected="true" aria-controls="hm-local-panel" data-source="local"></button>
        <button type="button" class="hm-source-tab" id="hm-tab-spotify" role="tab" aria-selected="false" aria-controls="hm-spotify-panel" data-source="spotify"></button>
      </div>
      <div class="hm-local-panel" id="hm-local-panel" role="tabpanel" aria-labelledby="hm-tab-local">
        <div class="hm-track-head">
          <div class="hm-record-art" aria-hidden="true"><span class="hm-record-disc"><i></i></span><span class="hm-art-mark">♫</span></div>
          <div class="hm-track-copy">
            <span class="hm-kicker" id="hm-now-label"></span>
            <strong class="hm-track-title" id="hm-track-title"></strong>
            <span class="hm-track-artist" id="hm-track-artist"></span>
            <span class="hm-status" id="hm-status" role="status" aria-live="polite"></span>
          </div>
        </div>
        <div class="hm-visual-wrap">
          <canvas id="hm-visualizer" class="hm-visualizer" aria-hidden="true"></canvas>
          <div class="hm-visual-caption" id="hm-visual-caption"></div>
        </div>
        <div class="hm-motion-row" id="hm-motion-row" hidden>
          <button type="button" class="hm-motion-toggle" id="hm-motion-toggle" aria-pressed="true"></button>
          <span id="hm-motion-hint"></span>
        </div>
        <div class="hm-progress-block">
          <input class="hm-range hm-seek" id="hm-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Seek through track">
          <div class="hm-time-row"><span id="hm-current-time">0:00</span><span id="hm-duration">0:00</span></div>
        </div>
        <div class="hm-control-row">
          <button type="button" class="hm-control hm-mode" id="hm-shuffle" aria-pressed="false"></button>
          <button type="button" class="hm-control hm-skip" id="hm-previous"></button>
          <button type="button" class="hm-control hm-play" id="hm-play"></button>
          <button type="button" class="hm-control hm-skip" id="hm-next"></button>
          <button type="button" class="hm-control hm-mode" id="hm-repeat" aria-pressed="false"></button>
        </div>
        <div class="hm-volume-row">
          <button type="button" class="hm-volume-mute" id="hm-mute"></button>
          <label class="sr-only" for="hm-volume" id="hm-volume-label"></label>
          <input class="hm-range hm-volume" id="hm-volume" type="range" min="0" max="1" value="0.78" step="0.01">
          <span class="hm-volume-value" id="hm-volume-value">78%</span>
        </div>
        <div class="hm-list-heading"><strong id="hm-list-title"></strong><span id="hm-track-count"></span></div>
        <div class="hm-track-list" id="hm-track-list" role="list" aria-label="Playlist tracks"></div>
        <p class="hm-hint" id="hm-local-hint"></p>
      </div>
      <div class="hm-spotify-panel" id="hm-spotify-panel" role="tabpanel" aria-labelledby="hm-tab-spotify" hidden>
        <p class="hm-hint" id="hm-spotify-hint"></p>
        <div id="hm-spotify-embed" class="hm-spotify-embed"></div>
        <a class="hm-spotify-link" id="hm-spotify-link" target="_blank" rel="noopener noreferrer"></a>
      </div>
    </section>
    <audio id="hm-audio" preload="none"></audio>
  `;
  document.body.appendChild(root);

  const $ = selector => root.querySelector(selector);
  const audio = $('#hm-audio');
  audio.crossOrigin = 'anonymous';
  const canvas = $('#hm-visualizer');
  const ctx = canvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    open: false, source: 'local', tracks: [], index: 0, playing: false,
    shuffle: false, repeat: 'off', volume: 0.78, muted: false,
    audioContext: null, analyser: null, sourceNode: null, frame: 0,
    frequencyBuffer: null, waveformBuffer: null,
    spotifyController: null, spotifyReady: false, spotifyPromise: null,
    beatPulse: 0, lastBeatAt: 0, fluxAverage: 0, highFluxAverage: 0, lastHighHitAt: 0, previousSpectrum: null, motionEnabled: true,
    lastProgressSave: 0, pendingTime: 0, resumeAfterStyleChange: false,
    staticDrawn: false, smoothedAccessibleBars: new Array(14).fill(0.12)
  };

  function updateText() {
    $('#hm-launch-label').textContent = t('open');
    $('#hm-launch').setAttribute('aria-label', `${t('open')} — ${config.title}`);
    $('#hm-drawer').setAttribute('aria-label', t('player'));
    $('.hm-source-tabs').setAttribute('aria-label', t('source'));
    $('#hm-track-list').setAttribute('aria-label', t('playlistTracks'));
    $('#hm-seek').setAttribute('aria-label', t('seek'));
    $('#hm-close').setAttribute('aria-label', t('close'));
    $('#hm-tab-local').textContent = t('local');
    $('#hm-tab-spotify').textContent = t('spotify');
    $('#hm-now-label').textContent = t('now');
    $('#hm-list-title').textContent = t('tracks');
    $('#hm-volume-label').textContent = t('volume');
    $('#hm-volume').setAttribute('aria-label', t('volume'));
    $('#hm-local-hint').textContent = t('localHint');
    $('#hm-spotify-hint').textContent = t('spotifyHint');
    $('#hm-brand-title').textContent = config.title;
    $('#hm-kicker').textContent = t(config.subtitleKey);
    $('#hm-visual-caption').textContent = t(config.captionKey);
    $('#hm-spotify-link').textContent = t('openSpotify');
    $('#hm-spotify-link').href = `https://open.spotify.com/playlist/${config.spotifyId}`;
    updateControlLabels();
    updateMotionControl();
  }

  function updateControlLabels() {
    const setControl = (selector, icon, label) => {
      const element = $(selector);
      element.innerHTML = `<span class="hm-control-icon" aria-hidden="true">${icon}</span><span class="hm-control-label">${escapeHTML(label)}</span>`;
      element.setAttribute('aria-label', label);
      element.title = label;
    };
    setControl('#hm-play', state.playing ? 'Ⅱ' : '▶', state.playing ? t('pause') : t('play'));
    setControl('#hm-mute', state.muted || state.volume === 0 ? '◖×' : '◖))', state.muted || state.volume === 0 ? t('unmute') : t('mute'));
    setControl('#hm-shuffle', '↝', t('shuffle'));
    setControl('#hm-repeat', '↻', state.repeat === 'all' ? t('repeatAll') : state.repeat === 'one' ? t('repeatOne') : t('repeatOff'));
    setControl('#hm-previous', '‹', t('previous'));
    setControl('#hm-next', '›', t('next'));
    $('#hm-volume').value = String(state.volume);
    $('#hm-volume-value').textContent = `${Math.round(state.volume * 100)}%`;
    $('#hm-shuffle').setAttribute('aria-pressed', String(state.shuffle));
    $('#hm-repeat').setAttribute('aria-pressed', String(state.repeat !== 'off'));
  }

  function updateMotionControl() {
    const row = $('#hm-motion-row');
    const button = $('#hm-motion-toggle');
    const hint = $('#hm-motion-hint');
    if (!row || !button || !hint) return;
    row.hidden = theme !== 'accessible';
    const systemOff = reducedMotion.matches;
    const enabled = state.motionEnabled && !systemOff;
    button.textContent = systemOff ? t('motionSystemOff') : enabled ? t('motionOn') : t('motionOff');
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', button.textContent);
    button.disabled = systemOff;
    hint.textContent = t('motionHint');
  }

  function applyMotionSetting() {
    const systemAllowsMotion = !reducedMotion.matches;
    const enabled = systemAllowsMotion && (theme !== 'accessible' || state.motionEnabled);
    if (typeof window.hotelAmbientSetMotion === 'function') window.hotelAmbientSetMotion(enabled);
    updateMotionControl();
    if (!enabled) {
      if (theme === 'accessible' || reducedMotion.matches) {
        stopVisualizer();
        drawStaticVisualizer();
      }
    } else if (state.playing) {
      startVisualizer();
    }
  }

  function setStatus(message) {
    let label = message || '';
    if (theme === 'accessible' && state.playing && message === t('playing')) label = `▶ CURRENTLY PLAYING — ${message}`;
    else if (theme === 'accessible' && (message === t('missing') || message === t('failed'))) label = `⚠ ${message}`;
    $('#hm-status').textContent = label;
  }
  function currentTrack() { return state.tracks[state.index] || null; }

  function renderTrackList() {
    const list = $('#hm-track-list');
    if (!state.tracks.length) {
      list.innerHTML = `<p class="hm-empty">${escapeHTML(t('noTracks'))}</p>`;
      $('#hm-track-count').textContent = '0';
      return;
    }
    $('#hm-track-count').textContent = String(state.tracks.length).padStart(2, '0');
    list.innerHTML = state.tracks.map((track, index) => `
      <button type="button" class="hm-track-row${index === state.index ? ' is-current' : ''}"
        aria-pressed="${index === state.index}" data-index="${index}">
        <span class="hm-track-index">${String(index + 1).padStart(2, '0')}</span>
        <span class="hm-track-row-copy"><strong>${escapeHTML(track.title)}</strong><small>${escapeHTML(track.artist || '')}</small></span>
        <span class="hm-track-row-duration">${fmtTime(track.duration)}</span>
      </button>`).join('');
    list.querySelectorAll('.hm-track-row').forEach(button => {
      button.addEventListener('click', () => selectTrack(Number(button.dataset.index), true));
    });
  }

  function updateTrackMeta() {
    const track = currentTrack();
    $('#hm-track-title').textContent = track ? track.title : t('idle');
    $('#hm-track-artist').textContent = track ? track.artist : '';
    $('#hm-duration').textContent = fmtTime(track ? track.duration : 0);
    renderTrackList();
  }

  function readSavedState() {
    try { return JSON.parse(localStorage.getItem('hotel-music-state-v1') || '{}'); }
    catch (_error) { return {}; }
  }
  const saved = readSavedState();
  state.volume = Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : 0.78;
  state.muted = Boolean(saved.muted);
  state.shuffle = Boolean(saved.shuffle);
  state.repeat = ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off';
  state.motionEnabled = saved.motionEnabled === undefined ? !reducedMotion.matches : Boolean(saved.motionEnabled);
  if (reducedMotion.matches) state.motionEnabled = false;
  state.volume = Math.max(0, Math.min(1, state.volume));
  audio.volume = state.volume;
  audio.muted = state.muted;

  let transition = null;
  try { transition = JSON.parse(sessionStorage.getItem('hotel-music-transition') || 'null'); }
  catch (_error) { transition = null; }
  try { sessionStorage.removeItem('hotel-music-transition'); } catch (_error) { /* private browsing */ }
  const perPack = saved.lastTracks && saved.lastTracks[config.pack];
  const requestedTrackId = transition && transition.pack === config.pack ? transition.trackId : perPack && perPack.trackId;
  state.pendingTime = transition && transition.pack === config.pack ? Math.max(0, Number(transition.time) || 0) : 0;
  state.resumeAfterStyleChange = Boolean(transition && transition.wasPlaying);
  const savedSource = transition && transition.source === 'spotify' ? 'spotify' : 'local';

  function persist() {
    const data = readSavedState();
    data.volume = state.volume;
    data.muted = state.muted;
    data.shuffle = state.shuffle;
    data.repeat = state.repeat;
    data.motionEnabled = state.motionEnabled;
    data.lastTracks = data.lastTracks || {};
    const track = currentTrack();
    if (track) data.lastTracks[config.pack] = { trackId: track.id, time: audio.currentTime || 0 };
    try { localStorage.setItem('hotel-music-state-v1', JSON.stringify(data)); } catch (_error) { /* storage may be disabled */ }
  }

  function loadSelectedTrack() {
    const track = currentTrack();
    if (!track) return;
    audio.src = track.url;
    audio.load();
    updateTrackMeta();
    setStatus(state.resumeAfterStyleChange ? t('resume') : '');
  }

  function selectTrack(index, autoPlay) {
    if (!state.tracks.length) return;
    const nextIndex = Math.max(0, Math.min(state.tracks.length - 1, Number(index) || 0));
    state.index = nextIndex;
    state.pendingTime = 0;
    state.resumeAfterStyleChange = false;
    loadSelectedTrack();
    persist();
    if (autoPlay) playLocal();
  }

  function setupAudioGraph() {
    if (state.audioContext) return state.audioContext.resume();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio API is not available in this browser.');
    const audioContext = new AudioContextClass();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.76;
    const sourceNode = audioContext.createMediaElementSource(audio);
    sourceNode.connect(analyser);
    analyser.connect(audioContext.destination);
    state.audioContext = audioContext;
    state.analyser = analyser;
    state.sourceNode = sourceNode;
    state.previousSpectrum = new Uint8Array(analyser.frequencyBinCount);
    state.frequencyBuffer = new Uint8Array(analyser.frequencyBinCount);
    state.waveformBuffer = new Uint8Array(analyser.fftSize);
    return audioContext.resume();
  }

  async function playLocal() {
    try {
      if (state.source === 'spotify') await switchSource('local');
      if (!audio.src && state.tracks.length) loadSelectedTrack();
      await setupAudioGraph();
      await audio.play();
      state.resumeAfterStyleChange = false;
    } catch (error) {
      setStatus(error && error.message && error.message.includes('Music archive') ? t('missing') : t('failed'));
      console.warn('[Hotel music] Playback could not start:', error);
    }
  }

  function pauseLocal() {
    audio.pause();
    state.playing = false;
    root.dataset.playing = 'false';
    stopVisualizer();
    updateControlLabels();
    setStatus(t('paused'));
    persist();
  }

  function chooseNextIndex() {
    if (!state.tracks.length) return -1;
    if (state.shuffle && state.tracks.length > 1) {
      let next = state.index;
      while (next === state.index) next = Math.floor(Math.random() * state.tracks.length);
      return next;
    }
    if (state.index < state.tracks.length - 1) return state.index + 1;
    return state.repeat === 'all' ? 0 : -1;
  }

  function nextTrack(autoPlay = true) {
    const index = chooseNextIndex();
    if (index < 0) {
      pauseLocal();
      return;
    }
    selectTrack(index, autoPlay);
  }

  function previousTrack() {
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const index = state.index > 0 ? state.index - 1 : (state.repeat === 'all' ? state.tracks.length - 1 : 0);
    selectTrack(index, true);
  }

  function spotifyApi() {
    if (state.spotifyPromise) return state.spotifyPromise;
    state.spotifyPromise = new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('Spotify Embed API timed out.')); }
      }, 15000);
      const oldCallback = window.onSpotifyIframeApiReady;
      window.onSpotifyIframeApiReady = api => {
        if (typeof oldCallback === 'function') {
          try { oldCallback(api); } catch (_error) { /* another embed may own the callback */ }
        }
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve(api);
      };
      let script = document.querySelector('script[data-hotel-spotify-api]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://open.spotify.com/embed/iframe-api/v1';
        script.async = true;
        script.dataset.hotelSpotifyApi = 'true';
        script.onerror = () => {
          if (!settled) { settled = true; window.clearTimeout(timeout); reject(new Error('Spotify Embed API failed to load.')); }
        };
        document.body.appendChild(script);
      }
    });
    return state.spotifyPromise;
  }

  async function createSpotifyEmbed() {
    if (state.spotifyController) {
      state.spotifyController.loadEntity(`spotify:playlist:${config.spotifyId}`);
      return;
    }
    $('#hm-spotify-embed').innerHTML = '';
    try {
      const api = await spotifyApi();
      api.createController($('#hm-spotify-embed'), {
        width: '100%', height: 352, uri: `spotify:playlist:${config.spotifyId}`
      }, controller => {
        state.spotifyController = controller;
        controller.addListener('ready', () => { state.spotifyReady = true; });
        controller.addListener('playback_started', () => {
          // Spotify mode only reports status. Do not drive any visualizer from Spotify events.
          if (state.source === 'spotify') setStatus('Spotify · ' + t('playing'));
        });
        controller.addListener('playback_update', event => {
          if (state.source === 'spotify') setStatus(event.data && event.data.isPaused ? 'Spotify · ' + t('paused') : 'Spotify · ' + t('playing'));
        });
      });
    } catch (error) {
      $('#hm-spotify-embed').innerHTML = `<p class="hm-empty">${escapeHTML(error.message || 'Spotify could not be loaded.')}</p>`;
    }
  }

  async function switchSource(source) {
    const next = source === 'spotify' ? 'spotify' : 'local';
    if (next === state.source) return;
    if (next === 'spotify') {
      pauseLocal();
      state.source = 'spotify';
      root.dataset.source = 'spotify';
      $('#hm-tab-local').classList.remove('is-active');
      $('#hm-tab-spotify').classList.add('is-active');
      $('#hm-tab-local').setAttribute('aria-selected', 'false');
      $('#hm-tab-spotify').setAttribute('aria-selected', 'true');
      $('#hm-local-panel').hidden = true;
      $('#hm-spotify-panel').hidden = false;
      stopVisualizer();
      await createSpotifyEmbed();
    } else {
      if (state.spotifyController) {
        try { state.spotifyController.pause(); } catch (_error) { /* embed may still be initializing */ }
      }
      state.source = 'local';
      root.dataset.source = 'local';
      $('#hm-tab-local').classList.add('is-active');
      $('#hm-tab-spotify').classList.remove('is-active');
      $('#hm-tab-local').setAttribute('aria-selected', 'true');
      $('#hm-tab-spotify').setAttribute('aria-selected', 'false');
      $('#hm-local-panel').hidden = false;
      $('#hm-spotify-panel').hidden = true;
      setStatus(t('paused'));
      drawStaticVisualizer();
    }
    persist();
  }

  function setOpen(open) {
    state.open = Boolean(open);
    $('#hm-drawer').hidden = !state.open;
    $('#hm-launch').setAttribute('aria-expanded', String(state.open));
    root.dataset.open = String(state.open);
    if (state.open && state.source === 'local') {
      resizeCanvas();
      if (state.playing) startVisualizer(); else drawStaticVisualizer();
    } else if (!state.open && !state.playing) {
      stopVisualizer();
    }
    if (state.open) $('#hm-close').focus({ preventScroll: true });
    else $('#hm-launch').focus({ preventScroll: true });
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  }

  function drawStaticVisualizer() {
    if (!ctx) return;
    const { width, height } = resizeCanvas();
    ctx.clearRect(0, 0, width, height);
    // No soundwave/equalizer before a local song starts or after it stops.
    // A frozen graphic is retained only for an actively playing reduced-motion session.
    if (!state.playing || state.source !== 'local') {
      state.staticDrawn = true;
      return;
    }
    if (theme === 'gta') {
      const bars = 24, gap = 5, barWidth = Math.max(3, (width - gap * (bars - 1)) / bars);
      for (let i = 0; i < bars; i++) {
        const h = 5 + ((i * 13) % 18);
        const x = i * (barWidth + gap);
        ctx.fillStyle = i % 2 ? '#FF2E88' : '#FFA24C';
        ctx.fillRect(x, height - h, barWidth, h);
      }
    } else if (theme === 'cyberpunk') {
      ctx.strokeStyle = '#00FFFF'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(0, height / 2); ctx.lineTo(width * .12, height / 2);
      ctx.lineTo(width * .18, height * .25); ctx.lineTo(width * .24, height * .75);
      ctx.lineTo(width * .3, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
    } else if (theme === 'accessible') {
      const heights = [12, 20, 16, 27, 18, 23, 14, 25, 18, 12, 21, 15];
      const gap = 7, barWidth = Math.max(4, (width - gap * heights.length) / heights.length);
      heights.forEach((h, i) => { ctx.fillStyle = '#1E3A8A'; ctx.fillRect(i * (barWidth + gap), height - h, barWidth, h); });
    } else {
      ctx.strokeStyle = '#D4AF37'; ctx.lineWidth = 2; ctx.beginPath();
      for (let x = 0; x <= width; x += 2) {
        const y = height / 2 + Math.sin(x / Math.max(18, width / 5)) * 5;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    state.staticDrawn = true;
  }

  function detectBeat(spectrum, now) {
    let bass = 0, flux = 0, highFlux = 0, highEnergy = 0;
    const bins = Math.min(12, spectrum.length);
    for (let i = 1; i < bins; i++) {
      bass += spectrum[i];
      const old = state.previousSpectrum ? state.previousSpectrum[i] : 0;
      flux += Math.max(0, spectrum[i] - old);
    }
    const sampleRate = state.audioContext ? state.audioContext.sampleRate : 44100;
    const binHz = sampleRate / (state.analyser ? state.analyser.fftSize : 2048);
    const highStart = Math.max(1, Math.floor(2800 / binHz));
    const highEnd = Math.min(spectrum.length - 1, Math.ceil(10000 / binHz));
    for (let i = highStart; i <= highEnd; i++) {
      const old = state.previousSpectrum ? state.previousSpectrum[i] : 0;
      highFlux += Math.max(0, spectrum[i] - old);
      highEnergy += spectrum[i];
    }
    bass /= Math.max(1, bins - 1);
    highEnergy /= Math.max(1, highEnd - highStart + 1) * 255;
    state.fluxAverage = state.fluxAverage * .94 + flux * .06;
    state.highFluxAverage = state.highFluxAverage * .92 + highFlux * .08;
    const threshold = Math.max(40, state.fluxAverage * 1.45);
    const highThreshold = Math.max(24, state.highFluxAverage * 1.72);
    const hit = flux > threshold && bass > 38 && now - state.lastBeatAt > 260;
    const highHit = highFlux > highThreshold && highEnergy > .035 && now - state.lastHighHitAt > 115;
    if (hit) {
      state.lastBeatAt = now;
      state.beatPulse = Math.min(1, .4 + bass / 200);
    }
    if (highHit) state.lastHighHitAt = now;
    if (state.previousSpectrum) state.previousSpectrum.set(spectrum);
    return { bass, flux, highFlux, highEnergy, hit, highHit };
  }

  function frequencyBand(spectrum, lowHz, highHz) {
    if (!state.analyser || !state.audioContext || !spectrum.length) return 0;
    const binHz = state.audioContext.sampleRate / state.analyser.fftSize;
    const first = Math.max(1, Math.floor(lowHz / binHz));
    const last = Math.min(spectrum.length - 1, Math.ceil(highHz / binHz));
    let sum = 0, count = 0;
    for (let i = first; i <= last; i++) { sum += spectrum[i]; count++; }
    return count ? sum / count / 255 : 0;
  }

  function waveformRms(waveform) {
    if (!waveform || !waveform.length) return 0;
    let sum = 0;
    for (let i = 0; i < waveform.length; i++) {
      const sample = (waveform[i] - 128) / 128;
      sum += sample * sample;
    }
    return Math.min(1, Math.sqrt(sum / waveform.length));
  }

  function drawGta(width, height, frequency, beat) {
    const bars = 32, gap = 4, barWidth = Math.max(2, (width - gap * (bars - 1)) / bars);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#FF2E88'); gradient.addColorStop(1, '#FFA24C');
    ctx.shadowColor = '#FF6B4A'; ctx.shadowBlur = 8; ctx.fillStyle = gradient;
    for (let i = 0; i < bars; i++) {
      const bin = Math.min(frequency.length - 1, Math.floor(2 + i * 2.1));
      const value = frequency[bin] / 255;
      const h = Math.max(3, value * height * .82 + state.beatPulse * height * .18);
      ctx.fillRect(i * (barWidth + gap), height - h, barWidth, h);
    }
    ctx.shadowBlur = 0;
    // A low horizon line pulses on detected kick-like transients.
    ctx.fillStyle = `rgba(255,255,255,${.3 + beat.bass / 900})`;
    ctx.fillRect(0, height - 2, width, 2);
  }

  function drawCyberpunk(width, height, waveform, beat) {
    ctx.strokeStyle = '#FF00FF'; ctx.lineWidth = 5; ctx.shadowColor = '#FF00FF'; ctx.shadowBlur = 12;
    ctx.beginPath();
    for (let i = 0; i < waveform.length; i += 3) {
      const x = (i / (waveform.length - 1)) * width;
      const y = (waveform[i] / 255) * height;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#00FFFF'; ctx.lineWidth = 1.8; ctx.shadowColor = '#00FFFF'; ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let i = 0; i < waveform.length; i += 2) {
      const x = (i / (waveform.length - 1)) * width;
      const y = (waveform[i] / 255) * height;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
    if (beat.hit) {
      ctx.fillStyle = 'rgba(0,255,255,.14)';
      ctx.fillRect(0, 0, width, height);
    }
  }

  function drawOfficial(width, height, frequency, beat) {
    const avg = frequency.reduce((a, b) => a + b, 0) / Math.max(1, frequency.length * 255);
    const amplitude = 3 + avg * height * .2 + state.beatPulse * height * .12;
    const phase = performance.now() / 850;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(212,175,55,.22)'); gradient.addColorStop(1, 'rgba(212,175,55,0)');
    ctx.beginPath();
    for (let x = 0; x <= width; x += 2) {
      const y = height / 2 + Math.sin(x / Math.max(16, width / 4) + phase) * amplitude;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
    ctx.beginPath();
    for (let x = 0; x <= width; x += 2) {
      const y = height / 2 + Math.sin(x / Math.max(16, width / 4) + phase) * amplitude;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#D4AF37'; ctx.lineWidth = 2; ctx.stroke();
  }

  function drawAccessible(width, height, frequency, beat) {
    const bars = 14, gap = 6, barWidth = Math.max(4, (width - gap * (bars - 1)) / bars);
    for (let i = 0; i < bars; i++) {
      const bin = Math.min(frequency.length - 1, 2 + i * 3);
      const target = Math.max(.08, frequency[bin] / 255 * .68 + state.beatPulse * .12);
      // Low-pass easing keeps the accessible bars slow and predictable.
      state.smoothedAccessibleBars[i] += (target - state.smoothedAccessibleBars[i]) * .085;
      const h = Math.max(5, state.smoothedAccessibleBars[i] * height);
      ctx.fillStyle = '#1E3A8A';
      ctx.fillRect(i * (barWidth + gap), height - h, barWidth, h);
    }
  }

  function drawFrame() {
    if (!state.playing || state.source !== 'local' || !state.analyser) { stopVisualizer(); return; }
    if (reducedMotion.matches || (theme === 'accessible' && !state.motionEnabled)) {
      stopVisualizer();
      drawStaticVisualizer();
      return;
    }

    const frequency = state.frequencyBuffer;
    const waveform = state.waveformBuffer;
    state.analyser.getByteFrequencyData(frequency);
    state.analyser.getByteTimeDomainData(waveform);
    const now = performance.now();
    const beat = detectBeat(frequency, now);
    const audioMetrics = {
      playing: true,
      bass: frequencyBand(frequency, 35, 180),
      mid: frequencyBand(frequency, 180, 2200),
      treble: frequencyBand(frequency, 2500, 10000),
      rms: waveformRms(waveform),
      beatHit: beat.hit,
      highHit: beat.highHit,
      pulse: state.beatPulse
    };
    // The page-wide particle field consumes these local-MP3 metrics even while
    // the floating player drawer is collapsed.
    if (typeof window.hotelAmbientAudioFrame === 'function') window.hotelAmbientAudioFrame(audioMetrics);

    if (state.open) {
      const { width, height } = resizeCanvas();
      if (width > 0 && height > 0) {
        ctx.clearRect(0, 0, width, height);
        if (theme === 'gta') drawGta(width, height, frequency, beat);
        else if (theme === 'cyberpunk') drawCyberpunk(width, height, waveform, beat);
        else if (theme === 'accessible') drawAccessible(width, height, frequency, beat);
        else drawOfficial(width, height, frequency, beat);
      }
    }
    state.beatPulse *= theme === 'accessible' ? .94 : .84;
    if (state.beatPulse < .015) state.beatPulse = 0;
    root.style.setProperty('--hm-beat', state.beatPulse.toFixed(3));
    root.style.setProperty('--hm-beat-scale', (1 + state.beatPulse * 0.06).toFixed(3));
    state.frame = requestAnimationFrame(drawFrame);
  }

  function startVisualizer() {
    if (!ctx || state.frame || state.source !== 'local' || !state.playing) return;
    if (reducedMotion.matches || (theme === 'accessible' && !state.motionEnabled)) { drawStaticVisualizer(); return; }
    if (state.open) resizeCanvas();
    state.frame = requestAnimationFrame(drawFrame);
  }

  function stopVisualizer() {
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.beatPulse = 0;
    root.style.setProperty('--hm-beat', '0');
    root.style.setProperty('--hm-beat-scale', '1');
    // Keep the ambience bridge aware of active local playback when motion is
    // intentionally frozen; a real pause/source switch still clears the wave.
    if (typeof window.hotelAmbientAudioFrame === 'function' && (!state.playing || state.source !== 'local')) {
      window.hotelAmbientAudioFrame({ playing: false });
    }
    if (!state.playing || state.source !== 'local') drawStaticVisualizer();
  }

  function updateProgress() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    $('#hm-current-time').textContent = fmtTime(current);
    $('#hm-duration').textContent = fmtTime(duration);
    $('#hm-seek').max = String(Math.max(1, Math.round(duration * 10)));
    $('#hm-seek').value = String(Math.round(current * 10));
    $('#hm-seek').style.setProperty('--hm-progress', `${duration ? current / duration * 100 : 0}%`);
    if (performance.now() - state.lastProgressSave > 2500) {
      state.lastProgressSave = performance.now();
      persist();
    }
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const track = currentTrack();
    if (!track || typeof window.MediaMetadata !== 'function') return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album || config.title });
    const actions = {
      play: () => playLocal(), pause: () => pauseLocal(),
      previoustrack: () => previousTrack(), nexttrack: () => nextTrack(true)
    };
    Object.entries(actions).forEach(([name, handler]) => {
      try { navigator.mediaSession.setActionHandler(name, handler); } catch (_error) { /* unsupported action */ }
    });
  }

  $('#hm-launch').addEventListener('click', () => setOpen(!state.open));
  $('#hm-close').addEventListener('click', () => setOpen(false));
  $('#hm-tab-local').addEventListener('click', () => switchSource('local'));
  $('#hm-tab-spotify').addEventListener('click', () => switchSource('spotify'));
  $('#hm-motion-toggle').addEventListener('click', () => {
    if (reducedMotion.matches) return;
    state.motionEnabled = !state.motionEnabled;
    persist();
    applyMotionSetting();
  });
  $('#hm-play').addEventListener('click', () => state.playing ? pauseLocal() : playLocal());
  $('#hm-previous').addEventListener('click', previousTrack);
  $('#hm-next').addEventListener('click', () => nextTrack(true));
  $('#hm-shuffle').addEventListener('click', () => { state.shuffle = !state.shuffle; updateControlLabels(); persist(); });
  $('#hm-repeat').addEventListener('click', () => { state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off'; updateControlLabels(); persist(); });
  $('#hm-mute').addEventListener('click', () => { state.muted = !state.muted; audio.muted = state.muted; updateControlLabels(); persist(); });
  $('#hm-volume').addEventListener('input', event => {
    state.volume = Math.min(1, Math.max(0, Number(event.target.value)));
    state.muted = state.volume === 0;
    audio.volume = state.volume; audio.muted = state.muted;
    updateControlLabels(); persist();
  });
  $('#hm-seek').addEventListener('input', event => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Number(event.target.value) / 10;
  });
  audio.addEventListener('play', () => {
    state.playing = true; root.dataset.playing = 'true';
    setStatus(t('playing')); updateControlLabels(); startVisualizer(); setupMediaSession(); persist();
  });
  audio.addEventListener('pause', () => {
    state.playing = false; root.dataset.playing = 'false';
    updateControlLabels(); stopVisualizer(); persist();
  });
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', () => {
    if (state.pendingTime > 0) {
      try { audio.currentTime = Math.min(state.pendingTime, Math.max(0, audio.duration - 1)); } catch (_error) { /* metadata may not be seekable yet */ }
      state.pendingTime = 0;
    }
    updateProgress();
  });
  audio.addEventListener('ended', () => {
    if (state.repeat === 'one') { audio.currentTime = 0; playLocal(); }
    else nextTrack(true);
  });
  audio.addEventListener('error', () => setStatus(t('missing')));
  document.addEventListener('keydown', event => {
    if (!state.open || state.source !== 'local') return;
    if (event.target && (/INPUT|TEXTAREA|SELECT|BUTTON|A/.test(event.target.tagName) || event.target.isContentEditable)) return;
    if (event.code === 'Space') { event.preventDefault(); state.playing ? pauseLocal() : playLocal(); }
    else if (event.key === 'ArrowRight') audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    else if (event.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
    else if (event.key.toLowerCase() === 'm') { state.muted = !state.muted; audio.muted = state.muted; updateControlLabels(); persist(); }
  });
  window.addEventListener('resize', () => { if (state.open) resizeCanvas(); });
  reducedMotion.addEventListener?.('change', () => {
    if (reducedMotion.matches) state.motionEnabled = false;
    updateMotionControl();
    applyMotionSetting();
    if (reducedMotion.matches) { stopVisualizer(); drawStaticVisualizer(); }
    else if (state.playing) startVisualizer();
  });

  window.addEventListener('pagehide', () => {
    const track = currentTrack();
    if (track) {
      try {
        sessionStorage.setItem('hotel-music-transition', JSON.stringify({
          pack: config.pack, trackId: track.id, time: audio.currentTime || 0,
          wasPlaying: state.playing, source: state.source
        }));
      } catch (_error) { /* session storage may be disabled */ }
    }
    persist();
  });

  // Keep the player labels in sync with the app's KZ / EN / RU language selector.
  const previousLanguageHook = window.hotelOnLanguageChange;
  window.hotelOnLanguageChange = function (...args) {
    if (typeof previousLanguageHook === 'function') previousLanguageHook.apply(this, args);
    updateText();
    renderTrackList();
  };

  const themeObserver = new MutationObserver(() => {
    // After Dark changes only visual skin variables; never reset playback state.
    root.dataset.afterDark = document.documentElement.dataset.afterDark || 'false';
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-after-dark'] });

  async function init() {
    updateText();
    applyMotionSetting();
    root.dataset.source = 'local';
    try {
      const response = await fetch('/static/music/catalog.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('Music catalog could not be loaded.');
      const catalog = await response.json();
      state.tracks = Array.isArray(catalog.playlists && catalog.playlists[config.pack]) ? catalog.playlists[config.pack] : [];
      let initialIndex = state.tracks.findIndex(track => String(track.id) === String(requestedTrackId));
      if (initialIndex < 0) initialIndex = 0;
      state.index = initialIndex;
      if (state.tracks.length) updateTrackMeta();
      else setStatus(t('missing'));
      if (saved.lastTracks && saved.lastTracks[config.pack] && !transition) {
        state.pendingTime = Math.max(0, Number(saved.lastTracks[config.pack].time) || 0);
      }
      updateControlLabels();
      renderTrackList();
      drawStaticVisualizer();
      if (savedSource === 'spotify') {
        // Restore the selected source, but never autoplay across a full-page style switch.
        root.dataset.source = 'local';
        state.source = 'local';
        if (state.resumeAfterStyleChange) setStatus(t('resume'));
      }
    } catch (error) {
      setStatus(t('missing'));
      console.error('[Hotel music] Could not initialize catalog:', error);
    }
  }

  init();
  window.hotelMusicPlayer = {
    open: () => setOpen(true), close: () => setOpen(false),
    play: playLocal, pause: pauseLocal,
    getState: () => ({ theme, pack: config.pack, source: state.source, playing: state.playing, track: currentTrack() })
  };
})();
