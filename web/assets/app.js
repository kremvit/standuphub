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

  function parseISO(s){
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtNum(n){
    if (n == null) return "";
    try { return new Intl.NumberFormat("uk-UA").format(n); }
    catch { return String(n); }
  }

  function fmtDate(iso){
    const d = parseISO(iso);
    if (!d) return "";
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

  // stable period cutoffs (avoid month edge cases)
  function nowUtcMs(){ return Date.now(); }
  function rangeCutoffMs(range){
    const DAY = 24 * 60 * 60 * 1000;
    if (range === "1m") return nowUtcMs() - 30 * DAY;
    if (range === "6m") return nowUtcMs() - 183 * DAY; // ~6 months
    if (range === "1y") return nowUtcMs() - 365 * DAY;
    return null;
  }

  function applyFilters(videos){
    let out = videos.slice();

    if (state.mode === "performer" && state.performer){
      const p = String(state.performer || "").toLowerCase();
      out = out.filter(v => String(v.performer || "").toLowerCase() === p);
    }

    const cutoffMs = rangeCutoffMs(state.range);
    if (cutoffMs){
      out = out.filter(v => {
        const d = parseISO(v.published_at);
        return d && d.getTime() >= cutoffMs;
      });
    }

    const q = String(state.search || "").trim().toLowerCase();
    if (q){
      out = out.filter(v => {
        const t = String(v.title || "").toLowerCase();
        const p = String(v.performer || "").toLowerCase();
        return t.includes(q) || p.includes(q);
      });
    }

    return out;
  }

  function applySort(videos){
    const out = videos.slice();
    if (state.sort === "views_desc"){
      out.sort((a,b) => (Number(b.view_count||0) - Number(a.view_count||0)));
      return out;
    }
    out.sort((a,b) => {
      const da = parseISO(a.published_at)?.getTime() || 0;
      const db = parseISO(b.published_at)?.getTime() || 0;
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
    const views = filteredAll.reduce((s,v)=> s + Number(v.view_count||0), 0);
    metaEl.textContent = `${fmtNum(count)} відео • ${fmtNum(views)} переглядів`;
    document.title = p ? `${p} • StandupHub` : "StandupHub";
  }

  // =========================
  // THEATER PLAYER (LIGHTBOX)
  // =========================
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

    // close handlers
    modalEl.addEventListener("click", (e) => {
      // close when clicking backdrop (not the panel)
      if (e.target === modalEl) closeModal();
    });

    const closeBtn = modalEl.querySelector(".ytModalClose");
    closeBtn.addEventListener("click", closeModal);

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modalEl.classList.contains("open")) closeModal();
    });
  }

  function openModal({ videoId, title }){
    ensureModal();
    if (!videoId) return;

    // stop any previous
    modalFrame.src = "";
    modalTitleEl.textContent = title || "";

    // autoplay
    const src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1`;
    modalFrame.src = src;

    modalEl.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeModal(){
    if (!modalEl) return;
    modalEl.classList.remove("open");
    document.body.style.overflow = "";
    if (modalFrame) modalFrame.src = ""; // stop playback
  }

  // =========================
  // GRID
  // =========================
  function renderGrid(videosPage){
    const grid = qs("grid");
    if (!grid) return;
    grid.innerHTML = "";

    for (const v of videosPage){
      const card = document.createElement("div");
      card.className = "card";

      const vid = v.video_id || "";
      const thumbUrl = vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : "";

      card.innerHTML = `
        <div class="thumb"
             style="background-image:url('${escapeAttr(thumbUrl)}'); background-size:cover; background-position:center;">
          <button class="playBtn" type="button" aria-label="Play">▶</button>
          <div class="duration">${fmtDuration(v.duration_sec)}</div>
        </div>

        <div class="cardBody">
          <div class="cardTitle">${escapeHtml(v.title)}</div>
          <div class="cardMeta">
            <a class="badge linkBadge" href="./comedian.html?p=${encodeURIComponent(v.performer || "")}">
              ${escapeHtml(v.performer || "")}
            </a>
            <span class="badge">${fmtNum(v.view_count)} views</span>
            <span class="badge">${fmtDate(v.published_at)}</span>
          </div>
        </div>
      `;

      const btn = card.querySelector(".playBtn");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        openModal({ videoId: vid, title: v.title || "YouTube video" });
      });

      grid.appendChild(card);
    }
  }

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

    const newUrl = `${location.pathname}?${params.toString()}`;
    history.replaceState({}, "", newUrl);
  }

  function readUrl(){
    const params = new URLSearchParams(location.search);
    const sort = params.get("sort");
    const range = params.get("range");
    const page = parseInt(params.get("page") || "1", 10);
    const q = params.get("q") || "";

    if (sort === "views_desc" || sort === "date_desc") state.sort = sort;
    if (["all","1m","6m","1y"].includes(range)) state.range = range;
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
        state.range = rangeEl.value;
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

  function escapeHtml(s){
    return String(s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }
  function escapeAttr(s){ return escapeHtml(s); }

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
    const [rating] = await Promise.all([ loadJson("data/rating.json") ]);
    DATA.rating = rating || [];
    renderSidebar();

    const table = qs("ratingTable");
    const search = document.getElementById("ratingSearch");

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
      const av = a[sortKey], bv = b[sortKey];
      let res = 0;

      if (col.type === "num"){
        res = (Number(av||0) - Number(bv||0));
      } else {
        res = String(av||"").localeCompare(String(bv||""), "uk");
      }
      return sortDir === "asc" ? res : -res;
    }

    function filteredRows(){
      let rows = (DATA.rating || []).slice();
      const qq = String(q||"").trim().toLowerCase();
      if (qq){
        rows = rows.filter(r => String(r.performer||"").toLowerCase().includes(qq));
      }
      rows.sort(cmp);
      return rows;
    }

    function renderTable(){
      if (!table) return;
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
                  return `<td>${isInt ? fmtNum(n) : (Number.isFinite(n) ? n.toFixed(4) : "")}</td>`;
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
        q = search.value;
        renderTable();
      });
    }

    renderTable();
  }

  async function initComedians(){
    const rating = await loadJson("data/rating.json");
    DATA.rating = rating || [];
    renderSidebar();

    const grid = qs("comediansGrid");
    const pag = qs("comediansPagination");
    const searchEl = qs("comediansSearch");

    let page = 1;
    const pageSize = 24;
    let q = "";

    function filtered(){
      let rows = (DATA.rating || []).slice();
      const qq = String(q||"").trim().toLowerCase();
      if (qq){
        rows = rows.filter(r => String(r.performer||"").toLowerCase().includes(qq));
      }
      rows.sort((a,b) => Number(a.rank||0) - Number(b.rank||0));
      return rows;
    }

    function paginateRows(rows){
      const total = rows.length;
      const pages = Math.max(1, Math.ceil(total / pageSize));
      page = Math.min(Math.max(1, page), pages);
      const start = (page - 1) * pageSize;
      return { slice: rows.slice(start, start + pageSize), pages };
    }

    function renderComedians(){
      if (!grid) return;
      const rows = filtered();
      const { slice, pages } = paginateRows(rows);

      grid.innerHTML = "";
      for (const r of slice){
        const a = document.createElement("a");
        a.className = "comedianCard";
        a.href = `./comedian.html?p=${encodeURIComponent(r.performer || "")}`;
        a.innerHTML = `
          <div>
            <div class="comedianName">#${escapeHtml(r.rank)} ${escapeHtml(r.performer)}</div>
            <div class="comedianMeta">
              <span class="comedianPill">${fmtNum(r.total_views)} views</span>
              <span class="comedianPill">${fmtNum(r.video_count)} videos</span>
              <span class="comedianPill">${Number(r.like_rate_smooth_pct||0).toFixed(2)}% like</span>
            </div>
          </div>
          <div class="sideRank">→</div>
        `;
        grid.appendChild(a);
      }

      if (pag){
        pag.innerHTML = "";

        const mkBtn = (text, disabled, active, onClick) => {
          const b = document.createElement("button");
          b.className = "pageBtn" + (active ? " active" : "");
          b.textContent = text;
          b.disabled = !!disabled;
          b.addEventListener("click", () => {
            if (b.disabled) return;
            onClick();
            renderComedians();
            window.scrollTo({top:0, behavior:"smooth"});
          });
          return b;
        };

        pag.appendChild(mkBtn("«", page===1, false, () => { page = Math.max(1, page-1); }));

        const maxButtons = 11;
        let start = Math.max(1, page - Math.floor(maxButtons/2));
        let end = Math.min(pages, start + maxButtons - 1);
        start = Math.max(1, end - maxButtons + 1);

        for (let p = start; p <= end; p++){
          pag.appendChild(mkBtn(String(p), false, p===page, () => { page = p; }));
        }

        pag.appendChild(mkBtn("»", page===pages, false, () => { page = Math.min(pages, page+1); }));
      }
    }

    if (searchEl){
      searchEl.addEventListener("input", () => {
        q = searchEl.value;
        page = 1;
        renderComedians();
      });
    }

    renderComedians();
  }

  async function initAbout(){
    const rating = await loadJson("data/rating.json");
    DATA.rating = rating || [];
    renderSidebar();
  }

  return { init, initRating, initComedians, initAbout };
})();
