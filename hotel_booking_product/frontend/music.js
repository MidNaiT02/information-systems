/* Theme-aware Spotify playlist launcher.
   Opens Spotify for each guest's own playback. The hotel site does not stream,
   control, modify, or synchronize Spotify audio. */
(() => {
  'use strict';

  const PLAYLISTS = {
    gta: {
      title: 'GTA VI playlist',
      url: 'https://open.spotify.com/playlist/359kPloDaoWnejGP6mxSi0?si=hhduv3HrQQa-8nYjhMwY0w'
    },
    cyberpunk: {
      title: 'Cyberpunk playlist',
      url: 'https://open.spotify.com/playlist/0cf3Aqb7GeyXHY4eIKFKcP?si=nxvZkZXeSOa1TZnZqKx6SA'
    },
    official: {
      title: 'Official playlist',
      url: 'https://open.spotify.com/playlist/37i9dQZF1EVJHK7Q1TBABQ?si=4juMbwhGTUaVyxnsC0xleA'
    }
  };

  const THEME_LABELS = {
    official: 'Official style',
    accessible: 'Color-blind accessible style',
    gta: 'GTA VI style',
    cyberpunk: 'Cyberpunk style'
  };
  const PLAYLIST_THEME = { official: 'official', accessible: 'official', gta: 'gta', cyberpunk: 'cyberpunk' };

  const widget = document.createElement('aside');
  widget.id = 'music-hub';
  widget.className = 'music-hub';
  widget.innerHTML = `
    <section class="music-panel" id="music-panel" aria-labelledby="music-panel-title" hidden>
      <div class="music-panel-head">
        <div>
          <span class="music-eyebrow">Soundtrack</span>
          <h2 id="music-panel-title">Official playlist</h2>
          <p id="music-theme-copy" class="music-theme-copy">Selected for Official style</p>
        </div>
        <button class="music-close" id="music-close" type="button" aria-label="Close music panel">×</button>
      </div>
      <div class="music-selection">
        <div class="music-note-icon" aria-hidden="true">♫</div>
        <div>
          <strong>Spotify playlist</strong>
          <p>Open Spotify to listen using your own account and playback controls.</p>
        </div>
      </div>
      <a class="music-open" id="music-open-spotify" aria-label="Open playlist in Spotify" href="https://open.spotify.com/playlist/37i9dQZF1EVJHK7Q1TBABQ?si=4juMbwhGTUaVyxnsC0xleA" target="_blank" rel="noopener noreferrer">
        Open playlist in Spotify <span aria-hidden="true">↗</span>
      </a>
      <div class="music-divider"></div>
      <p class="music-footnote">Nothing plays automatically. Playback controls and lyrics stay in Spotify.</p>
      <div class="music-footer"><span>Playlist selected by visual style</span><span class="spotify-wordmark">Spotify</span></div>
    </section>
    <button class="music-toggle" id="music-toggle" type="button" aria-expanded="false" aria-controls="music-panel">
      <span class="music-toggle-mark" aria-hidden="true">♫</span><span>Music playlists</span><span class="music-toggle-caret" aria-hidden="true">⌃</span>
    </button>`;

  document.body.appendChild(widget);

  const panel = widget.querySelector('#music-panel');
  const toggle = widget.querySelector('#music-toggle');
  const close = widget.querySelector('#music-close');
  const title = widget.querySelector('#music-panel-title');
  const themeCopy = widget.querySelector('#music-theme-copy');
  const openLink = widget.querySelector('#music-open-spotify');

  function currentTheme() {
    const value = document.documentElement.dataset.theme || 'official';
    return Object.prototype.hasOwnProperty.call(THEME_LABELS, value) ? value : 'official';
  }

  function updateForTheme() {
    const theme = currentTheme();
    const playlistTheme = PLAYLIST_THEME[theme] || 'official';
    const playlist = PLAYLISTS[playlistTheme];
    widget.dataset.theme = theme;
    title.textContent = playlist.title;
    themeCopy.textContent = THEME_LABELS[theme] || THEME_LABELS.official;
    openLink.href = playlist.url;
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    widget.classList.toggle('is-open', open);
    if (open) close.focus();
    else toggle.focus();
  }

  toggle.addEventListener('click', () => {
    updateForTheme();
    setOpen(panel.hidden);
  });
  close.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  updateForTheme();
  const themeObserver = new MutationObserver(records => {
    if (records.some(record => record.attributeName === 'data-theme')) updateForTheme();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
