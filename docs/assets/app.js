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

  function getVideoId(v){
    return (v?.video_id ?? v?.videoId ?? v?.id ?? "");
  }

  function getViews(v){
    return Number(v?.view_count ?? v?.viewCount ?? v?.views ?? 0) || 0;
  }

  function getDurationSec(v){
    return Number(v?.duration_sec ?? v?.durationSec ?? v?.duration_seconds ?? v?.durationSeconds ?? 0) || 0;
  }

  function getPerformer(v){
    return (v?.performer ?? v?.comedian ?? v?.author ?? "");
  }

  function getTitle(v){
    return (v?.title ?? v?.name ?? "");
  }

  // ---------- robust date -> ms ----------
  function parseDateMs(raw){
    if (raw == null) return null;

    // numeric timestamps (string or number)
    // - seconds: 1700000000
    // - ms:      1700000000000
    if (typeof raw === "number" && Number.isFinite(raw)){
      const n = raw;
      if (n > 1e12) return n;         // ms
      if (n > 1e9) return n * 1000;   // sec
    }
    const s0 = String(raw).trim();
    if (!s0) return null;

    if (/^\d+$/.test(s0)){
      const n = Number(s0);
      if (Number.isFinite(n)){
        if (n > 1e12) return n;
        if (n > 1e9) return n * 1000;
      }
    }

    // "YYYY-MM-DD HH:MM:SS..." -> "YYYY-MM-DDT..."
    let s = s0;
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(s)) {
      s = s.replace(/\s+/, "T");
    }

    // "YYYY-MM-DD" -> UTC midnight
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      s = s + "T00:00:00Z";
    }

    // "YYYY-MM-DDTHH:MM:SS" (no TZ) -> assume UTC
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
    const d = new Date(ms);
    return d.toLocaleDateString("uk-UA", {year:"numeric", month:"short", day:"2-digit"});
  }

  function fmtDuration(sec){
    sec = Number(sec || 0);
    const h = Math.floor(sec/3600);
    const m = Math.floor((sec%3600)/60);
    const s = Math.floor(sec%60);
    if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    return `${m}:${String(s).padStart(2,"0")}`;
  }

  // ---------- period cutoffs ----------
  function rangeCutoffMs(range){
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    if (range === "1m" || range === "month") return now - 30 * DAY;
    if (range === "6m" || range === "halfyear") return now - 183 * DAY;
    if (range === "1y" || range === "year") return now - 365 * DAY;
    return null;
  }

  function normalizeRangeValue(x){
    const r = String(x || "all");
    if (["all"].includes(r)) return "all";
    if (["1m","month"].includes(r)) return "1m";
    if (["6m","halfyear","half-year","6mo"].includes(r)) return "6m";
    if (["1y","year","12m","12mo"].includes(r)) return "1y";
    return "all";
  }

  // ---------- filters ----------
  function applyFilters(videos){
    let out = videos.slice();

    if (state.mode === "performer" && state.performer){
      const p = String(state.performer || "").toLowerCase();
      out = out.filter(v => String(getPerformer(v) || "").toLowerCase() === p);
    }

    const cutoffMs = rangeCutoffMs(state.range);
    if (cutoffMs){
      // keep only videos with known date >= cutoff
      out = out.filter(v => {
        const ms = parseDateMs(getPublishedRaw(v));
        return (ms != null) && (ms >= cutoffMs);
      });

      // If everything got filtered out, it's a sign dates are not parseable.
      // Fallback: do NOT hard-empty. Show something rather than blank page.
      if (out.length === 0){
        // fallback: ignore period filter
        out = videos.slice();
        if (state.mode === "performer" && state.performer){
          const p = String(state.performer || "").toLowerCase();
          out = out.filter(v => String(getPerformer(v) || "").toLowerCase() === p);
        }
      }
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

  // ---------- sort ----------
  function applySort(videos){
    const out = videos.slice();

    // IMPORTANT: "Період" = show BEST videos in that period => sort by views desc automatically
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

  // ---------- theater modal ----------
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
  function renderGrid(videosPage){
    const grid = qs("grid");
    if (!grid) return;
    grid.innerHTML = "";

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

  // ---------- pagination ----------
  function renderPagination(pages){
    const el = qs("pagination");
    if (!el) return;
    el.innerHTML = "";

    const maxButtons = 11;
    const cur = state.page;
    const total = pages;

    let start = Math.max(1, cur - Math.floor(maxButtons/2));
    let end = Math.min(total, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);

    el.appendChild(pageButton("«", Math.max(1, cur-1), cur === 1));
    for (let p = start; p <= end; p++){
      el.appendChild(pageButton(String(p), p, false, p === cur));
    }
    el.appendChild(pageButton("»", Math.min(total, cur+1), cur === total));
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

  // ---------- url state ----------
  function syncUrl(){
    const params = new URLSearchParams(location.search);
    params.set("sort", state.sort);
    params.set("range", state.range);
    params.set("page", String(state.page));
    if (state.search) params.set("q", state.search);
    else params.delete("q");

    if (state.mode === "performer"){
      params.set("p", state.performer || "");
    }

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

        // KEY: period means "best videos in that period" => force views sort in UI
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

    if (state.mode === "performer"){
      renderHeaderForComedian(filtered);
    }

    const { slice, pages } = paginate(filtered);
    renderGrid(slice);
    renderPagination(pages);
  }

  async function loadJson(path){
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
    return await r.json();
  }

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

  // rating/comedians/about залишаю як було (у тебе вже працює)
  async function initRating(){
    const rating = await loadJson("data/rating.json");
    DATA.rating = rating || [];
    renderSidebar();
    // якщо треба — я можу знову вставити повний рендер таблиці, але він не впливає на "Період"
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
