// Space/room isolation manager, open photo upload drawer, wish composer/wall, and optional admin moderation.
import { WISH_THEMES } from './wishes.js?v=9';

const TOKEN_KEY = 'xmas-admin-token';
const RECENT_KEY = 'xmas-recent-rooms';
const PASS_PREFIX = 'xmas-room-pass:';
const $ = (id) => document.getElementById(id);

function formatTime(ts) {
  if (!ts) return '圣诞示范签';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function extractSlug(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  try {
    if (s.includes('://') || s.includes('?tree=')) {
      const u = new URL(s.startsWith('http') ? s : `https://x/${s.replace(/^\/+/, '')}`);
      const q = u.searchParams.get('tree');
      if (q) return q.trim().toLowerCase();
    }
  } catch { /* fallback to plain slug */ }
  return s.toLowerCase();
}

export class SpaceController {
  constructor({ getAdminToken, onSpaceReady, toast }) {
    this.getAdminToken = getAdminToken;
    this.onSpaceReady = onSpaceReady;
    this.toast = toast;
    this.slug = 'public';
    this.info = { slug: 'public', title: '公共圣诞树', locked: false, authorized: true, url: '/' };

    this.modal = $('room-modal');
    this.lockModal = $('room-lock-modal');

    $('btn-space').onclick = () => this.openModal();
    $('room-modal-close').onclick = () => this.closeModal();
    this.modal.onclick = (e) => { if (e.target === this.modal) this.closeModal(); };

    $('rtab-create').onclick = () => this.setTab('create');
    $('rtab-join').onclick = () => this.setTab('join');

    $('room-copy-link').onclick = () => this.copyCurrentLink();
    $('room-go-public').onclick = () => { this.closeModal(); this.switchTo('public', true); };
    $('room-create-btn').onclick = () => this.createRoom();
    $('room-join-btn').onclick = () => this.joinInput();
    $('room-join-input').onkeydown = (e) => { if (e.key === 'Enter') this.joinInput(); };

    $('lock-submit-btn').onclick = () => this.unlockWithInput();
    $('lock-pass-input').onkeydown = (e) => { if (e.key === 'Enter') this.unlockWithInput(); };
    $('lock-go-public').onclick = () => { this.closeLock(); this.switchTo('public', true); };

    addEventListener('popstate', () => {
      const target = this.readSlugFromUrl();
      if (target !== this.slug) this.switchTo(target, false);
    });
  }

  get isAnyModalOpen() {
    return this.modal.classList.contains('open') || this.lockModal.classList.contains('open');
  }

  readSlugFromUrl() {
    const q = new URLSearchParams(location.search).get('tree');
    return (q || '').trim().toLowerCase() || 'public';
  }

  getPasscode(slug = this.slug) {
    return slug === 'public' ? '' : (sessionStorage.getItem(PASS_PREFIX + slug) || '');
  }

  setPasscode(slug, pass) {
    if (slug === 'public') return;
    pass ? sessionStorage.setItem(PASS_PREFIX + slug, pass) : sessionStorage.removeItem(PASS_PREFIX + slug);
  }

  apiQuery() {
    return this.slug === 'public' ? '' : `?tree=${encodeURIComponent(this.slug)}`;
  }

  apiHeaders(extra = {}) {
    const h = { ...extra };
    const pass = this.getPasscode();
    if (pass) h['X-Room-Passcode'] = pass;
    const admin = this.getAdminToken?.();
    if (admin) h['X-Admin-Token'] = admin;
    return h;
  }

  shareUrl() {
    const u = new URL(location.href);
    u.hash = '';
    if (this.slug === 'public') u.search = '';
    else u.search = `?tree=${encodeURIComponent(this.slug)}`;
    return u.toString();
  }

  saveRecent(info) {
    if (!info || info.slug === 'public') return;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { list = []; }
    list = [{ slug: info.slug, title: info.title, locked: info.locked }, ...list.filter((x) => x.slug !== info.slug)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  }

  renderRecent() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { list = []; }
    const wrap = $('room-recent-wrap');
    const box = $('room-recent-list');
    box.innerHTML = '';
    wrap.hidden = !list.length;
    for (const item of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = `${item.locked ? '🔒 ' : '🎄 '}${item.title || item.slug}`;
      btn.onclick = () => { this.closeModal(); this.switchTo(item.slug, true); };
      box.appendChild(btn);
    }
  }

  openModal() {
    this.renderBanner();
    this.renderRecent();
    this.modal.classList.add('open');
    this.modal.setAttribute('aria-hidden', 'false');
  }

  closeModal() {
    this.modal.classList.remove('open');
    this.modal.setAttribute('aria-hidden', 'true');
  }

  openLock(info, errMsg = '') {
    $('lock-title').textContent = `🔒 ${info.title || info.slug}`;
    $('lock-error').textContent = errMsg;
    $('lock-pass-input').value = '';
    this.lockModal.classList.add('open');
    this.lockModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => $('lock-pass-input').focus(), 140);
  }

  closeLock() {
    this.lockModal.classList.remove('open');
    this.lockModal.setAttribute('aria-hidden', 'true');
  }

  setTab(tab) {
    const isCreate = tab === 'create';
    $('rtab-create').classList.toggle('active', isCreate);
    $('rtab-join').classList.toggle('active', !isCreate);
    $('rpane-create').hidden = !isCreate;
    $('rpane-join').hidden = isCreate;
  }

  renderBanner() {
    const isPub = this.slug === 'public';
    const shortTitle = this.info.title.length > 10 ? `${this.info.title.slice(0, 9)}…` : this.info.title;
    $('btn-space').textContent = isPub ? '🌍 公共树' : `${this.info.locked ? '🔒' : '🎄'} ${shortTitle}`;
    $('subtitle').textContent = isPub
      ? '公共圣诞树 · 所有人都能看到彼此的祝福与照片'
      : `${this.info.title} · 专属隔离圣诞树`;
    $('room-current-title').textContent = isPub
      ? '🌍 公共圣诞树'
      : `${this.info.locked ? '🔒' : '🎄'} ${this.info.title} (${this.slug})`;
    $('room-current-desc').textContent = isPub
      ? '所有人可见并共同装扮这棵树'
      : (this.info.locked ? '隔离空间（需密码访问），与公共树互不可见' : '隔离空间（持链接可进），与公共树互不可见');
    $('room-go-public').hidden = isPub;
    $('wish-space-hint').textContent = isPub
      ? '无需口令，匿名写下一句圣诞祝福，它会化作星光书签飞上公共圣诞树。'
      : `当前处于隔离空间「${this.info.title}」，祝福仅在此空间内可见。`;
  }

  async copyCurrentLink() {
    const url = this.shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      this.toast('分享链接已复制，发给朋友即可一起装扮 🎄');
    } catch {
      prompt('复制下方链接发给朋友：', url);
    }
  }

  async switchTo(slug, pushHistory = true) {
    slug = (slug || 'public').trim().toLowerCase() || 'public';
    if (slug === 'public') {
      this.slug = 'public';
      this.info = { slug: 'public', title: '公共圣诞树', locked: false, authorized: true, url: '/' };
      if (pushHistory) history.pushState({}, '', '/');
      this.closeLock();
      this.renderBanner();
      await this.onSpaceReady?.(this.info);
      return true;
    }

    const prevSlug = this.slug;
    this.slug = slug;
    const r = await fetch(`api/rooms/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
      headers: this.apiHeaders(),
    });
    if (r.status === 404) {
      this.slug = prevSlug;
      this.toast(`找不到空间「${slug}」，已停留在当前圣诞树`);
      if (prevSlug === 'public' && pushHistory) history.replaceState({}, '', '/');
      this.renderBanner();
      await this.onSpaceReady?.(this.info);
      return false;
    }
    const data = await r.json().catch(() => ({}));
    this.info = data.room;
    if (pushHistory) history.pushState({}, '', `/?tree=${encodeURIComponent(slug)}`);
    this.renderBanner();
    this.saveRecent(this.info);

    if (this.info.locked && !this.info.authorized) {
      this.openLock(this.info);
      return false;
    }
    this.closeLock();
    await this.onSpaceReady?.(this.info);
    return true;
  }

  async unlockWithInput() {
    const pass = $('lock-pass-input').value.trim();
    if (!pass) return;
    this.setPasscode(this.slug, pass);
    const r = await fetch(`api/rooms/${encodeURIComponent(this.slug)}`, {
      cache: 'no-store',
      headers: this.apiHeaders(),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.room?.authorized) {
      this.info = data.room;
      this.closeLock();
      this.renderBanner();
      this.toast(`已进入「${this.info.title}」🎄`);
      await this.onSpaceReady?.(this.info);
    } else {
      this.setPasscode(this.slug, '');
      $('lock-error').textContent = '访问密码不正确，请重试';
    }
  }

  async createRoom() {
    const title = $('room-title-input').value.trim();
    const slug = $('room-slug-input').value.trim();
    const passcode = $('room-pass-input').value.trim();
    const btn = $('room-create-btn');
    btn.disabled = true;
    try {
      const r = await fetch('api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, slug, passcode }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        this.toast(data.error || `创建失败 (${r.status})`);
        return;
      }
      const room = data.room;
      if (passcode) this.setPasscode(room.slug, passcode);
      $('room-title-input').value = '';
      $('room-slug-input').value = '';
      $('room-pass-input').value = '';
      this.closeModal();
      await this.switchTo(room.slug, true);
      const url = this.shareUrl();
      navigator.clipboard?.writeText(url).catch(() => {});
      this.toast(`专属树「${room.title}」已创建，链接已复制 🎄✨`, 3800);
    } catch {
      this.toast('网络开小差了，请重试');
    } finally {
      btn.disabled = false;
    }
  }

  joinInput() {
    const slug = extractSlug($('room-join-input').value);
    if (!slug) { this.toast('请输入空间编号或链接'); return; }
    $('room-join-input').value = '';
    this.closeModal();
    this.switchTo(slug, true);
  }
}

export class PhotoManager {
  constructor({ space, onChange, onTokenChange, toast }) {
    this.space = space;
    this.onChange = onChange;
    this.onTokenChange = onTokenChange;
    this.toast = toast;
    this.token = localStorage.getItem(TOKEN_KEY) || '';
    this.photos = [];
    this.drawer = $('drawer');
    $('btn-manage').onclick = () => this.open();
    $('drawer-close').onclick = () => this.close();
    $('token-btn').onclick = () => this.login($('token-input').value.trim());
    $('token-input').onkeydown = (e) => { if (e.key === 'Enter') $('token-btn').click(); };
    $('logout-btn').onclick = () => { this.setToken(''); };
    const input = $('file-input');
    input.onchange = () => { this.upload([...input.files]); input.value = ''; };
    const dz = $('dropzone');
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); this.upload([...e.dataTransfer.files]); };
    this.renderAuth();
  }

  open() { this.drawer.classList.add('open'); this.drawer.setAttribute('aria-hidden', 'false'); }
  close() { this.drawer.classList.remove('open'); this.drawer.setAttribute('aria-hidden', 'true'); }
  get isOpen() { return this.drawer.classList.contains('open'); }

  setToken(t) {
    this.token = t;
    t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
    this.renderAuth();
    this.renderGrid();
    this.onTokenChange?.(t);
  }

  async login(t) {
    if (!t) return;
    const r = await fetch('api/auth', { headers: { 'X-Admin-Token': t } });
    if (r.ok) { this.setToken(t); $('token-input').value = ''; this.toast('站长模式已开启，可删除任意照片或祝福 🔐'); }
    else this.toast('口令不对哦');
  }

  renderAuth() {
    $('login-box').hidden = !!this.token;
    $('admin-authed-bar').hidden = !this.token;
  }

  async refresh() {
    try {
      const r = await fetch(`api/photos${this.space.apiQuery()}`, {
        cache: 'no-store',
        headers: this.space.apiHeaders(),
      });
      if (!r.ok) {
        this.photos = [];
      } else {
        this.photos = (await r.json()).photos || [];
      }
    } catch (e) {
      console.warn(e);
      this.photos = [];
    }
    this.renderGrid();
    this.onChange(this.photos);
    return this.photos;
  }

  renderGrid() {
    const grid = $('photo-grid');
    grid.innerHTML = '';
    $('photo-count').textContent = `(${this.photos.length})`;
    if (!this.photos.length) {
      grid.innerHTML = '<div class="empty">还没有人上传照片，快来挂上第一张回忆吧～</div>';
      return;
    }
    for (const p of this.photos) {
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = p.url; img.loading = 'lazy'; img.alt = '';
      fig.appendChild(img);
      if (this.token) {
        const del = document.createElement('button');
        del.className = 'del'; del.textContent = '删除';
        del.onclick = () => this.remove(p.id);
        fig.appendChild(del);
      }
      grid.appendChild(fig);
    }
  }

  async upload(files) {
    files = files.filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const prog = $('upload-progress');
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      prog.textContent = `上传中 ${i + 1} / ${files.length} …`;
      const r = await fetch(`api/photos${this.space.apiQuery()}`, {
        method: 'POST',
        body: files[i],
        headers: this.space.apiHeaders({ 'Content-Type': 'application/octet-stream' }),
      });
      if (r.ok) { ok++; continue; }
      const err = (await r.json().catch(() => ({}))).error || `上传失败 (${r.status})`;
      this.toast(`${files[i].name}: ${err}`);
      if (r.status === 403 || r.status === 409 || r.status === 429) break;
    }
    prog.textContent = ok ? `成功挂上 ${ok} 张照片 ✨` : '';
    if (ok) this.toast(`已把 ${ok} 张照片挂到圣诞树上 📷✨`);
    await this.refresh();
  }

  async remove(id) {
    if (!confirm('确定要删除这张照片吗？')) return;
    const r = await fetch(`api/photos/${id}${this.space.apiQuery()}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': this.token },
    });
    if (!r.ok) {
      if (r.status === 401) this.setToken('');
      this.toast('删除失败');
    }
    await this.refresh();
  }
}

export class WishManager {
  constructor({ space, onChange, onCreated, onSelectWish, onStepFocus, onUnfocus, getToken, onInvalidToken, toast }) {
    this.space = space;
    this.onChange = onChange;
    this.onCreated = onCreated;
    this.onSelectWish = onSelectWish;
    this.onStepFocus = onStepFocus;
    this.onUnfocus = onUnfocus;
    this.getToken = getToken;
    this.onInvalidToken = onInvalidToken;
    this.toast = toast;
    this.wishes = [];
    this.theme = 'crimson';
    this.submitting = false;

    this.modal = $('wish-modal');
    this.focusBar = $('wish-focus-bar');

    $('btn-wish').onclick = () => this.openModal('write');
    $('wish-modal-close').onclick = () => this.closeModal();
    this.modal.onclick = (e) => { if (e.target === this.modal) this.closeModal(); };

    $('tab-write').onclick = () => this.setTab('write');
    $('tab-wall').onclick = () => this.setTab('wall');

    const textEl = $('wish-text');
    textEl.oninput = () => { $('wish-chars').textContent = `${textEl.value.length} / 80`; };
    $('wish-submit').onclick = () => this.submit();
    $('wish-author').onkeydown = (e) => { if (e.key === 'Enter') this.submit(); };

    $('wish-prev').onclick = () => this.onStepFocus?.(-1);
    $('wish-next').onclick = () => this.onStepFocus?.(1);
    $('wish-unfocus').onclick = () => this.onUnfocus?.();
    $('wish-write-from-focus').onclick = () => {
      this.onUnfocus?.();
      this.openModal('write');
    };

    this.buildSwatches();
  }

  get isModalOpen() { return this.modal.classList.contains('open'); }

  setFocusBarVisible(show) {
    this.focusBar.classList.toggle('show', !!show);
    this.focusBar.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  buildSwatches() {
    const wrap = $('wish-swatches');
    wrap.innerHTML = '';
    for (const [key, cfg] of Object.entries(WISH_THEMES)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `swatch${key === this.theme ? ' selected' : ''}`;
      btn.dataset.theme = key;
      const dot = document.createElement('i');
      dot.style.background = cfg.bg[1];
      btn.append(dot, document.createTextNode(cfg.label));
      btn.onclick = () => {
        this.theme = key;
        wrap.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('selected', b.dataset.theme === key));
      };
      wrap.appendChild(btn);
    }
  }

  openModal(tab = 'write') {
    this.onUnfocus?.();
    this.modal.classList.add('open');
    this.modal.setAttribute('aria-hidden', 'false');
    this.setTab(tab);
    if (tab === 'write') setTimeout(() => $('wish-text').focus(), 140);
  }

  closeModal() {
    this.modal.classList.remove('open');
    this.modal.setAttribute('aria-hidden', 'true');
  }

  setTab(tab) {
    const isWrite = tab === 'write';
    $('tab-write').classList.toggle('active', isWrite);
    $('tab-wall').classList.toggle('active', !isWrite);
    $('pane-write').hidden = !isWrite;
    $('pane-wall').hidden = isWrite;
  }

  async refresh() {
    try {
      const r = await fetch(`api/wishes${this.space.apiQuery()}`, {
        cache: 'no-store',
        headers: this.space.apiHeaders(),
      });
      if (!r.ok) {
        this.wishes = [];
      } else {
        this.wishes = (await r.json()).wishes || [];
      }
    } catch (e) {
      console.warn(e);
      this.wishes = [];
    }
    this.renderLists();
    this.onChange(this.wishes);
    return this.wishes;
  }

  renderLists() {
    const countText = this.wishes.length ? `(${this.wishes.length})` : '';
    $('wall-count').textContent = countText;
    $('admin-wish-count').textContent = `(${this.wishes.length})`;

    const wall = $('wish-wall');
    wall.innerHTML = '';
    if (!this.wishes.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '还没有人写祝福，成为第一个在这棵树上挂书签的人吧 ✨';
      wall.appendChild(empty);
    } else {
      for (const w of this.wishes) {
        const th = WISH_THEMES[w.theme] || WISH_THEMES.crimson;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'wish-item';
        item.style.borderLeftColor = th.bg[1];
        const p = document.createElement('p');
        p.textContent = w.text;
        const meta = document.createElement('div');
        meta.className = 'meta';
        const author = document.createElement('span');
        author.textContent = `— ${w.author || '匿名'}`;
        const time = document.createElement('span');
        time.textContent = formatTime(w.t);
        meta.append(author, time);
        item.append(p, meta);
        item.onclick = () => {
          this.closeModal();
          this.onSelectWish?.(w);
        };
        wall.appendChild(item);
      }
    }

    const adminList = $('admin-wish-list');
    adminList.innerHTML = '';
    if (!this.wishes.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = '当前空间暂无访客祝福签';
      adminList.appendChild(empty);
      return;
    }
    const token = this.getToken();
    for (const w of this.wishes) {
      const row = document.createElement('div');
      row.className = 'admin-wish';
      const body = document.createElement('div');
      const p = document.createElement('p');
      p.textContent = w.text;
      const sm = document.createElement('small');
      sm.textContent = `${w.author || '匿名'} · ${formatTime(w.t)}`;
      body.append(p, sm);
      row.appendChild(body);
      if (token) {
        const del = document.createElement('button');
        del.className = 'del';
        del.textContent = '删除';
        del.onclick = () => this.remove(w.id);
        row.appendChild(del);
      }
      adminList.appendChild(row);
    }
  }

  async submit() {
    if (this.submitting) return;
    const textEl = $('wish-text');
    const authorEl = $('wish-author');
    const text = textEl.value.trim();
    const author = authorEl.value.trim();
    if (!text) {
      this.toast('先写一句祝福再挂上去吧 🔖');
      textEl.focus();
      return;
    }
    this.submitting = true;
    const btn = $('wish-submit');
    btn.disabled = true;
    try {
      const r = await fetch(`api/wishes${this.space.apiQuery()}`, {
        method: 'POST',
        headers: this.space.apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text, author, theme: this.theme }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        this.toast(data.error || `提交失败 (${r.status})`);
        return;
      }
      textEl.value = '';
      $('wish-chars').textContent = '0 / 80';
      this.closeModal();
      await this.refresh();
      this.onCreated?.(data.wish);
      this.toast('你的祝福书签正飞上圣诞树 🔖✨', 3200);
    } catch {
      this.toast('网络开小差了，请重试');
    } finally {
      this.submitting = false;
      btn.disabled = false;
    }
  }

  async remove(id) {
    if (!confirm('确定要删除这条祝福签吗？')) return;
    const r = await fetch(`api/wishes/${id}${this.space.apiQuery()}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Token': this.getToken() },
    });
    if (!r.ok) {
      if (r.status === 401) this.onInvalidToken?.();
      this.toast('删除失败');
    }
    await this.refresh();
  }
}
