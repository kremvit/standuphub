const StandupHub = (() => {
  const DATA = { videos: [], rating: [] };

  const state = {
    mode: "all",
    performer: null,
    sort: "date_desc",
    range: "all",
    page: 1,
    pageSize: 10,
    search: ""
  };

  function qs(id){ return document.getElementById(id); }

  // ---------- tolerant getters ----------
  function getPublishedRaw(v){
    return (
      v?.published_at ??
      v?.publishedAt ??
      v?.published ??
      v?.published_date ??
      v?.date ??
      v?.snippet?.publishedAt ??
      ""
    );
  }
  function getVideoId(v){ return (v?.video_id ?? v?.videoId ?? v?.id ?? ""); }
  function getViews(v){ return Number(v?.view_count ?? v?.viewCount ?? v?.views ?? 0) || 0; }
  function getDurationSec(v){
    return Number(v?.duration_sec ?? v?.durationSec ?? v?.duration_seconds ?? v?.durationSeconds ?? 0) || 0;
  }
  function getPerformer(v){ return (v?.performer ?? v?.comedian ?? v?.author ?? ""); }
  function getTitle(v){ return (v?.title ?? v?.name ?? ""); }

  // ---------- robust date -> ms ----------
  function parseDateMs(raw){
    if (raw == null) return null;

    if (typeof raw === "number" && Number.isFinite(raw)){
      if (raw > 1e12) return raw;
      if (raw > 1e9) return raw * 1000;
    }

    let s = String(raw).trim();
    if (!s) return null;

    if (/^\d+$/.test(s)){
      const n = Number(s);
      if (Number.isFinite(n)){
        if (n > 1e12) return n;
        if (n > 1e9) return n * 1000;
      }
    }

    const ymd = s.match(/(\d{4}-\d{2}-\d{2})/);
    if (ymd && !s.startsWith(ymd[1])) {
      const d = new Date(ymd[1] + "T00:00:00Z");
      if (!isNaN(d.getTime())) return d.getTime();
    }

    const dmy = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dmy){
      const iso = `${dmy[3]}-${dmy[2]}-${dmy[1]}T00:00:00Z`;
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d.getTime();
    }

    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(s)) {
      s = s.replace(/\s+/, "T");
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      s = s + "T00:00:00Z";
    }

    s = s.replace(/(\d),(\d)/g, "$1.$2");
    s = s.replace(/\.(\d{3})\d+/g, ".$1");
    s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
      s = s + "Z";
    }

    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  function fmtNum(n){
    if (n == null) return "";
    try { return new Intl.NumberFormat("uk-UA").format(n); }
    catch { return String(n); }
  }

  function fmtDate(raw){
    const ms = parseDateMs(raw);
    if (!ms) return "";
    return new Date(ms).toLocaleDateString("uk-UA", {year:"numeric", month:"short", day:"2-digit"});
  }

  function fmtDuration(sec){
    sec = Number(sec || 0);
    const h = Math.floor(sec/3600);
    const m = Math.floor((sec%3600)/60);
    const s = Math.floor(sec%60);
    if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    return `${m}:${String(s).padStart(2,"0")}`;
  }

  function normalizeRangeValue(x){
    const r = String(x || "all");
    if (r === "all") return "all";
    if (["1m","month"].includes(r)) return "1m";
    if (["6m","halfyear","half-year","6mo"].includes(r)) return "6m";
    if (["1y","year","12m","12mo"].includes(r)) return "1y";
    return "all";
  }

  function rangeCutoffMs(range){
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    if (range === "1m") return now - 30 * DAY;
    if (range === "6m") return now - 183 * DAY;
    if (range === "1y") return now - 365 * DAY;
    return null;
  }

  function applyFilters(videos){
    let out = videos.slice();

    if (state.mode === "performer" && state.performer){
      const p = String(state.performer || "").toLowerCase();
      out = out.filter(v => String(getPerformer(v) || "").toLowerCase() === p);
    }

    const cutoffMs = rangeCutoffMs(state.range);
    if (cutoffMs){
      out = out.filter(v => {
        const ms = parseDateMs(getPublishedRaw(v));
        return (ms != null) && (ms >= cutoffMs);
      });
    }

    const q = String(state.search || "").trim().toLowerCase();
    if (q){
      out = out.filter(v => {
        const t = String(getTitle(v) || "").toLowerCase();
        const p = String(getPerformer(v) || "").toLowerCase();
        return t.includes(q) || p.includes(q);
      });
    }

    return out;
  }

  // “Найкраще” (range != all) => sort views desc
  function applySort(videos){
    const out = videos.slice();
    const effectiveSort = (state.range !== "all") ? "views_desc" : state.sort;

    if (effectiveSort === "views_desc"){
      out.sort((a,b) => getViews(b) - getViews(a));
      return out;
    }

    out.sort((a,b) => {
      const da = parseDateMs(getPublishedRaw(a)) || 0;
      const db = parseDateMs(getPublishedRaw(b)) || 0;
      return db - da;
    });
    return out;
  }

  function paginate(videos){
    const total = videos.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);

    const start = (state.page - 1) * state.pageSize;
    const slice = videos.slice(start, start + state.pageSize);
    return { slice, total, pages };
  }

  function escapeHtml(s){
    return String(s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }
  function escapeAttr(s){ return escapeHtml(s); }

  // ---------- sidebar ----------
  function renderSidebar(){
    const el = qs("sidebarTop");
    if (!el) return;
    el.innerHTML = "";
    const top = (DATA.rating || []).slice(0, 10);
    for (const r of top){
      const a = document.createElement("a");
      a.className = "sideItem";
      a.href = `./comedian.html?p=${encodeURIComponent(r.performer)}`;
      a.innerHTML = `
        <div class="sideLeft">
          <div class="sideName">${escapeHtml(r.performer)}</div>
          <div class="sideMeta">${fmtNum(r.total_views)} переглядів • ${fmtNum(r.video_count)} відео</div>
        </div>
        <div class="sideRank">#${r.rank}</div>
      `;
      el.appendChild(a);
    }
  }

  function renderHeaderForComedian(filteredAll){
    const titleEl = qs("comedianTitle");
    const metaEl = qs("comedianMeta");
    if (!titleEl || !metaEl) return;

    const p = state.performer || "";
    titleEl.textContent = p || "Комік";
    const count = filteredAll.length;
    const views = filteredAll.reduce((s,v)=> s + getViews(v), 0);
    metaEl.textContent = `${fmtNum(count)} відео • ${fmtNum(views)} переглядів`;
    document.title = p ? `${p} • StandupHub` : "StandupHub";
  }

  // ---------- modal ----------
  let modalEl = null;
  let modalFrame = null;
  let modalTitleEl = null;

  function ensureModal(){
    if (modalEl) return;
    modalEl = document.createElement("div");
    modalEl.className = "ytModal";
    modalEl.innerHTML = `
      <div class="ytModalPanel" role="dialog" aria-modal="true">
        <div class="ytModalTop">
          <div class="ytModalTitle" id="ytModalTitle"></div>
          <button class="ytModalClose" type="button" aria-label="Close">✕</button>
        </div>
        <div class="ytModalVideo">
          <iframe class="ytModalFrame" id="ytModalFrame"
            src=""
            title="YouTube video"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen></iframe>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalFrame = modalEl.querySelector("#ytModalFrame");
    modalTitleEl = modalEl.querySelector("#ytModalTitle");

    modalEl.addEventListener("click", (e) => { if (e.target === modalEl) closeModal(); });
    modalEl.querySelector(".ytModalClose").addEventListener("click", closeModal);

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modalEl.classList.contains("open")) closeModal();
    });
  }

  function openModal({ videoId, title }){
    ensureModal();
    if (!videoId) return;

    modalFrame.src = "";
    modalTitleEl.textContent = title || "";
    modalFrame.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1`;
    modalEl.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeModal(){
    if (!modalEl) return;
    modalEl.classList.remove("open");
    document.body.style.overflow = "";
    if (modalFrame) modalFrame.src = "";
  }

  // ---------- grid ----------
  function renderGrid(videosPage, totalFiltered){
    const grid = qs("grid");
    if (!grid) return;
    grid.innerHTML = "";

    if (totalFiltered === 0){
      grid.innerHTML = `
        <div class="aboutCard" style="grid-column: 1 / -1;">
          <h2 style="margin:0 0 8px;">Нічого не знайдено</h2>
          <p style="margin:0;color:var(--muted);">
            Для цього періоду немає відео.
          </p>
        </div>
      `;
      return;
    }

    for (const v of videosPage){
      const card = document.createElement("div");
      card.className = "card";

      const vid = getVideoId(v);
      const thumbUrl = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : "";

      const title = getTitle(v);
      const performer = getPerformer(v);
      const views = getViews(v);
      const dur = getDurationSec(v);
      const pub = getPublishedRaw(v);

      card.innerHTML = `
        <div class="thumb"
             style="background-image:url('${escapeAttr(thumbUrl)}'); background-size:cover; background-position:center;">
          <button class="playBtn" type="button" aria-label="Play">▶</button>
          <div class="duration">${fmtDuration(dur)}</div>
        </div>

        <div class="cardBody">
          <div class="cardTitle">${escapeHtml(title)}</div>
          <div class="cardMeta">
            <a class="badge linkBadge" href="./comedian.html?p=${encodeURIComponent(performer || "")}">
              ${escapeHtml(performer || "")}
            </a>
            <span class="badge">${fmtNum(views)} views</span>
            <span class="badge">${fmtDate(pub)}</span>
          </div>
        </div>
      `;

      card.querySelector(".playBtn").addEventListener("click", (e) => {
        e.preventDefault();
        openModal({ videoId: vid, title: title || "YouTube video" });
      });

      grid.appendChild(card);
    }
  }

  function renderPagination(pages, total){
    const el = qs("pagination");
    if (!el) return;
    el.innerHTML = "";
    if (total === 0) return;

    const maxButtons = 11;
    const cur = state.page;
    const totalPages = pages;

    let start = Math.max(1, cur - Math.floor(maxButtons/2));
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);

    el.appendChild(pageButton("«", Math.max(1, cur-1), cur === 1));
    for (let p = start; p <= end; p++){
      el.appendChild(pageButton(String(p), p, false, p === cur));
    }
    el.appendChild(pageButton("»", Math.min(totalPages, cur+1), cur === totalPages));
  }

  function pageButton(text, page, disabled, active=false){
    const b = document.createElement("button");
    b.className = "pageBtn" + (active ? " active" : "");
    b.textContent = text;
    b.disabled = !!disabled;
    b.addEventListener("click", () => {
      state.page = page;
      syncUrl();
      render();
      window.scrollTo({top:0, behavior:"smooth"});
    });
    return b;
  }

  function syncUrl(){
    const params = new URLSearchParams(location.search);
    params.set("sort", state.sort);
    params.set("range", state.range);
    params.set("page", String(state.page));
    if (state.search) params.set("q", state.search);
    else params.delete("q");

    if (state.mode === "performer") params.set("p", state.performer || "");
    history.replaceState({}, "", `${location.pathname}?${params.toString()}`);
  }

  function readUrl(){
    const params = new URLSearchParams(location.search);
    const sort = params.get("sort");
    const range = normalizeRangeValue(params.get("range"));
    const page = parseInt(params.get("page") || "1", 10);
    const q = params.get("q") || "";

    if (sort === "views_desc" || sort === "date_desc") state.sort = sort;
    state.range = range;
    if (Number.isFinite(page) && page > 0) state.page = page;
    state.search = q;
  }

  function bindControls(){
    const sortEl = qs("sortSelect");
    const rangeEl = qs("rangeSelect");
    const searchEl = qs("searchInput");

    if (sortEl){
      sortEl.value = state.sort;
      sortEl.addEventListener("change", () => {
        state.sort = sortEl.value;
        state.page = 1;
        syncUrl();
        render();
      });
    }

    if (rangeEl){
      rangeEl.value = state.range;
      rangeEl.addEventListener("change", () => {
        state.range = normalizeRangeValue(rangeEl.value);

        // when range selected: force sort UI to views
        if (state.range !== "all" && sortEl){
          state.sort = "views_desc";
          sortEl.value = "views_desc";
        }

        state.page = 1;
        syncUrl();
        render();
      });
    }

    if (searchEl){
      searchEl.value = state.search;
      let t = null;
      searchEl.addEventListener("input", () => {
        state.search = searchEl.value;
        state.page = 1;
        syncUrl();
        clearTimeout(t);
        t = setTimeout(render, 120);
      });
    }
  }

  function render(){
    let filtered = applyFilters(DATA.videos || []);
    filtered = applySort(filtered);

    if (state.mode === "performer") renderHeaderForComedian(filtered);

    const { slice, total, pages } = paginate(filtered);
    renderGrid(slice, total);
    renderPagination(pages, total);
  }

  async function loadJson(path){
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
    return await r.json();
  }

  // ---------- INIT PAGES ----------
  async function init({mode, performer}){
    state.mode = mode;
    state.performer = performer;

    readUrl();

    const [videos, rating] = await Promise.all([
      loadJson("data/videos.json"),
      loadJson("data/rating.json"),
    ]);

    DATA.videos = videos || [];
    DATA.rating = rating || [];

    renderSidebar();
    bindControls();
    render();
  }

  // ✅ FULL rating table renderer (fixes empty rating.html)
  async function initRating(){
    const rating = await loadJson("data/rating.json");
    DATA.rating = rating || [];
    renderSidebar();

    const table = qs("ratingTable");
    const search = qs("ratingSearch");
    if (!table) return;

    const columns = [
      { key:"rank", label:"#", type:"num" },
      { key:"performer", label:"Комік", type:"text" },
      { key:"score", label:"Score", type:"num" },
      { key:"total_views", label:"Total views", type:"num" },
      { key:"peak_views", label:"Peak", type:"num" },
      { key:"video_count", label:"Videos", type:"num" },
      { key:"total_minutes", label:"Minutes", type:"num" },
      { key:"like_rate_smooth_pct", label:"Like %", type:"num" },
    ];

    let sortKey = "rank";
    let sortDir = "asc";
    let q = "";

    function cmp(a,b){
      const col = columns.find(c=>c.key===sortKey) || columns[0];
      const av = a?.[sortKey], bv = b?.[sortKey];
      let res = 0;

      if (col.type === "num") res = (Number(av||0) - Number(bv||0));
      else res = String(av||"").localeCompare(String(bv||""), "uk");

      return sortDir === "asc" ? res : -res;
    }

    function filteredRows(){
      let rows = (DATA.rating || []).slice();
      const qq = String(q||"").trim().toLowerCase();
      if (qq) rows = rows.filter(r => String(r.performer||"").toLowerCase().includes(qq));
      rows.sort(cmp);
      return rows;
    }

    function renderTable(){
      const rows = filteredRows();

      const thead = `
        <thead>
          <tr>
            ${columns.map(c => {
              const active = c.key === sortKey;
              const arrow = active ? (sortDir === "asc" ? "▲" : "▼") : "↕";
              return `<th data-key="${escapeAttr(c.key)}">${escapeHtml(c.label)}<span class="sortHint">${arrow}</span></th>`;
            }).join("")}
          </tr>
        </thead>
      `;

      const tbody = `
        <tbody>
          ${rows.map(r => `
            <tr>
              ${columns.map(c => {
                if (c.key === "performer"){
                  const p = r.performer || "";
                  return `<td><a class="performerLink" href="./comedian.html?p=${encodeURIComponent(p)}">${escapeHtml(p)}</a></td>`;
                }
                const val = r[c.key];
                if (c.type === "num"){
                  const n = Number(val);
                  const isInt = Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9;
                  if (!Number.isFinite(n)) return `<td></td>`;
                  return `<td>${isInt ? fmtNum(n) : n.toFixed(4)}</td>`;
                }
                return `<td>${escapeHtml(val)}</td>`;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      `;

      table.innerHTML = thead + tbody;

      table.querySelectorAll("th[data-key]").forEach(th => {
        th.addEventListener("click", () => {
          const k = th.getAttribute("data-key");
          if (k === sortKey) sortDir = (sortDir === "asc" ? "desc" : "asc");
          else { sortKey = k; sortDir = "asc"; }
          renderTable();
        });
      });
    }

    if (search){
      search.addEventListener("input", () => {
        q = search.value || "";
        renderTable();
      });
    }

    renderTable();
  }

  async function initComedians(){
    const rating = await loadJson("data/rating.json");
    DATA.rating = rating || [];
    renderSidebar();
  }

  async function initAbout(){
    const rating = await loadJson("data/rating.json");
    DATA.rating = rating || [];
    renderSidebar();
  }

  return { init, initRating, initComedians, initAbout };
})();
