const StandupHub = (() => {
  const DATA = { videos: [], rating: [] };

  const state = {
    mode: "all",
    performer: null,
    sort: "date_desc",
    range: "all",     // all | 1m | 6m | 1y
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
  // Handles:
  // - ISO: 2025-12-22T10:11:12Z / +00:00 / +0000
  // - microseconds: .123456 -> .123
  // - "YYYY-MM-DD HH:MM:SS"
  // - numeric timestamps sec/ms
  // - extracts YYYY-MM-DD from ANY string
  // - supports DD.MM.YYYY (common UA)
  function parseDateMs(raw){
    if (raw == null) return null;

    // numeric timestamps
    if (typeof raw === "number" && Number.isFinite(raw)){
      if (raw > 1e12) return raw;         // ms
      if (raw > 1e9) return raw * 1000;   // sec
    }

    let s = String(raw).trim();
    if (!s) return null;

    // digits-only timestamps
    if (/^\d+$/.test(s)){
      const n = Number(s);
      if (Number.isFinite(n)){
        if (n > 1e12) return n;
        if (n > 1e9) return n * 1000;
      }
    }

    // If contains YYYY-MM-DD anywhere, extract it (super tolerant fallback)
    // e.g. "published: 2025-12-22, ..." -> "2025-12-22"
    const ymd = s.match(/(\d{4}-\d{2}-\d{2})/);
    if (ymd && !s.startsWith(ymd[1])) {
      // Try build ISO from extracted date only (UTC midnight)
      const d = new Date(ymd[1] + "T00:00:00Z");
      if (!isNaN(d.getTime())) return d.getTime();
    }

    // DD.MM.YYYY fallback
    const dmy = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dmy){
      const iso = `${dmy[3]}-${dmy[2]}-${dmy[1]}T00:00:00Z`;
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d.getTime();
    }

    // "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDT..."
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(s)) {
      s = s.replace(/\s+/, "T");
    }

    // "YYYY-MM-DD" -> UTC midnight
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      s = s + "T00:00:00Z";
    }

    // decimal comma -> dot
    s = s.replace(/(\d),(\d)/g, "$1.$2");

    // trim fractional seconds to ms: .123456 -> .123
    s = s.replace(/\.(\d{3})\d+/g, ".$1");

    // normalize TZ +0200 -> +02:00
    s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

    // if datetime without TZ -> assume UTC
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

  // ---------- range cutoffs ----------
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

  // ---------- filters ----------
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

  // ---------- sort ----------
  // “Найкраще” = в межах періоду показуємо BEST за переглядами.
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

  // ---------- debug helpers for empty period ----------
  function periodDebug(videosAll){
    const parsed = [];
    for (const v of videosAll){
      const ms = parseDateMs(getPublishedRaw(v));
      if (ms != null) parsed.push(ms);
    }
    parsed.sort((a,b)=>a-b);
    const newest = parsed.length ? new Date(parsed[parsed.length-1]).toISOString() : "N/A";
    const oldest = parsed.length ? new Date(parsed[0]).toISOString() : "N/A";
    return { total: videosAll.length, parsedCount: parsed.length, newest, oldest };
  }

  // ---------- grid ----------
  function renderGrid(videosPage, totalFiltered){
    const grid = qs("grid");
    if (!grid) return;
    grid.innerHTML = "";

    if (totalFiltered === 0){
      const dbg = periodDebug(DATA.videos || []);
      grid.innerHTML = `
        <div class="aboutCard" style="grid-column: 1 / -1;">
          <h2 style="margin:0 0 8px;">Нічого не знайдено</h2>
          <p style="margin:0;color:var(--muted);line-height:1.4">
            Для цього періоду немає відео, або сайт не зміг розпізнати дату публікації у <code>data/videos.json</code>.
          </p>
          <p style="margin:10px 0 0;color:var(--muted);font-size:13px;line-height:1.4">
            Debug: videos=${dbg.total}, parsed_dates=${dbg.parsedCount},
            oldest=${escapeHtml(dbg.oldest)}, newest=${escapeHtml(dbg.newest)}
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

  // ---------- pagination ----------
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

  // ---------- url state ----------
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

        // when "Найкраще" selected: force UI sort to views
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

  async function initRating(){
    const rating = await loadJson("data/rating.json");
    DATA.rating = rating || [];
    renderSidebar();
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
