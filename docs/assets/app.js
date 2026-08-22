const StandupHub = (() => {
  const DATA = { videos: [], rating: [], bios: {}, biosIndex: new Map(), recommendations: {}, events: {} };

  const state = {
    mode: "all",
    performer: null,
    sort: "date_desc",
    range: "all",
    year: "all",
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
  function getLikes(v){ return Number(v?.like_count ?? v?.likeCount ?? v?.likes ?? 0) || 0; }
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

    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(s)) s = s.replace(/\s+/, "T");
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s = s + "T00:00:00Z";

    s = s.replace(/(\d),(\d)/g, "$1.$2");
    s = s.replace(/\.(\d{3})\d+/g, ".$1");
    s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) s = s + "Z";

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

  function buildBiosIndex(bios){
    const index = new Map();
    const entries = Object.entries(bios || {});

    for (const [key, value] of entries){
      const item = value || {};
      const variants = [key, item.name, ...(Array.isArray(item.aliases) ? item.aliases : [])];
      for (const variant of variants){
        const norm = String(variant || "").trim().toLowerCase();
        if (!norm || index.has(norm)) continue;
        index.set(norm, item);
      }
    }

    return index;
  }

  function getBioByPerformerName(name){
    const norm = String(name || "").trim().toLowerCase();
    if (!norm) return null;
    return DATA.biosIndex.get(norm) || null;
  }

  function escapeRegex(text){
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const CLUB_LOGOS = {
    underground: "assets/club-logos/underground.jpg",
    brodiachyi: "assets/club-logos/brodiachyi.jpg",
    cherepakha: "assets/club-logos/cherepakha.jpg",
    battleClub: "assets/club-logos/battle.jpg",
  };

  function sanitizeBioText(rawText, performerName, bioName){
    let text = String(rawText || "").trim();
    if (!text) return "";

    const leadingNames = [performerName, bioName]
      .map(v => String(v || "").trim())
      .filter(Boolean);

    for (const name of leadingNames){
      const pattern = new RegExp(`^${escapeRegex(name)}\\s*[-—:]\\s*`, "i");
      text = text.replace(pattern, "").trim();
    }

    text = text
      .replace(/український/gi, "")
      .replace(/українська/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+,/g, ",")
      .replace(/\s+\./g, ".")
      .trim();

    text = text.replace(/^([^\p{L}]*)(\p{L})/u, (m, prefix, firstChar) => {
      return prefix + firstChar.toLocaleUpperCase("uk-UA");
    });

    return text;
  }

  function applyBioMobileToggle(bioEl){
    const textEl = bioEl.querySelector(".comedianBioText");
    const toggleEl = bioEl.querySelector(".comedianBioToggle");
    if (!textEl || !toggleEl) return;

    const isMobile = window.matchMedia("(max-width: 720px)").matches;
    textEl.classList.remove("isCollapsed");
    toggleEl.hidden = true;

    if (!isMobile) return;

    const lineHeight = parseFloat(window.getComputedStyle(textEl).lineHeight) || 22;
    const lineCount = Math.ceil(textEl.scrollHeight / lineHeight);

    if (lineCount <= 6) return;

    textEl.classList.add("isCollapsed");
    toggleEl.hidden = false;
    toggleEl.textContent = "Більше...";

    toggleEl.addEventListener("click", () => {
      const expanded = toggleEl.getAttribute("aria-expanded") === "true";
      if (expanded){
        textEl.classList.add("isCollapsed");
        toggleEl.textContent = "Більше...";
        toggleEl.setAttribute("aria-expanded", "false");
      } else {
        textEl.classList.remove("isCollapsed");
        toggleEl.textContent = "Менше";
        toggleEl.setAttribute("aria-expanded", "true");
      }
    });
  }

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

  // ---------- performer card ----------
  function renderPerformerCard(filteredAll){
    const cardEl = qs("performerCard");
    if (!cardEl) return;

    const performer = state.performer || "";
    if (!performer){
      cardEl.classList.remove("active");
      return;
    }

    // Try to find photo with .jpg or .png extension
    const photoFormats = [".jpg", ".png"];
    let photoPath = null;
    let checkCount = 0;

    function tryNextFormat(){
      if (checkCount >= photoFormats.length){
        // No photo found, use generated avatar
        const avatarUrl = generateAvatarUrl(performer);
        displayPerformerCard(performer, avatarUrl, filteredAll);
        return;
      }

      const format = photoFormats[checkCount];
      const testPath = `./photo/${encodeURIComponent(performer)}${format}`;
      checkCount++;

      fetch(testPath, { method: "HEAD", cache: "no-cache" })
        .then(r => {
          if (r.ok){
            photoPath = testPath;
            displayPerformerCard(performer, photoPath, filteredAll);
          } else {
            tryNextFormat();
          }
        })
        .catch(() => {
          tryNextFormat();
        });
    }

    tryNextFormat();
  }

  function generateAvatarUrl(name){
    // Return SVG silhouette instead of generating avatar with letters
    const silhouette = `
      <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#1f1f2b;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#0d0d14;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="200" height="200" fill="url(#grad)"/>
        <circle cx="100" cy="60" r="35" fill="#666"/>
        <path d="M 50 120 Q 50 100 100 100 Q 150 100 150 120 L 150 180 Q 150 200 130 200 L 70 200 Q 50 200 50 180 Z" fill="#888"/>
      </svg>
    `;
    return "data:image/svg+xml," + encodeURIComponent(silhouette);
  }

  function displayPerformerCard(performer, imageUrl, filteredAll){
    const cardEl = qs("performerCard");
    if (!cardEl) return;

    const count = filteredAll.length;
    const views = filteredAll.reduce((s,v)=> s + getViews(v), 0);
    const performerData = DATA.performers?.[performer] || {};
    const instagram = performerData.instagram;
    
    let instagramHtml = "";
    if (instagram){
      instagramHtml = `
        <a href="${escapeAttr(instagram)}" target="_blank" rel="noopener noreferrer" class="performerInstagramLink">
          Instagram
        </a>
      `;
    }
    
    cardEl.innerHTML = `
      <img src="${escapeAttr(imageUrl)}" alt="${escapeHtml(performer)}" />
      <div class="performerCardBody">
        <div class="performerCardName">${escapeHtml(performer)}</div>
        <div class="performerCardStat">
          <span class="performerCardStatLabel">Відео:</span>
          <span class="performerCardStatValue">${fmtNum(count)}</span>
        </div>
        <div class="performerCardStat">
          <span class="performerCardStatLabel">Переглядів:</span>
          <span class="performerCardStatValue">${fmtNum(views)}</span>
        </div>
        ${instagramHtml ? `<div class="performerCardInstagram">${instagramHtml}</div>` : ""}
      </div>
    `;
    cardEl.classList.add("active");
  }

  function renderPerformerBio(){
    const bioEl = qs("comedianBio");
    if (!bioEl) return;

    if (state.mode !== "performer" || !state.performer){
      bioEl.hidden = true;
      bioEl.innerHTML = "";
      return;
    }

    const bioData = getBioByPerformerName(state.performer);
    const bioText = sanitizeBioText(bioData?.bio, state.performer, bioData?.name);

    if (!bioText){
      bioEl.hidden = true;
      bioEl.innerHTML = "";
      return;
    }

    const suffix = "за версією Gemini";
    const baseText = bioText.endsWith(suffix)
      ? bioText.slice(0, -suffix.length).trim()
      : bioText;

    bioEl.innerHTML = `
      <p class="comedianBioText">${escapeHtml(baseText)}</p>
      <button class="comedianBioToggle" type="button" aria-expanded="false" hidden>Більше...</button>
      <div class="comedianBioSource" aria-label="Джерело біографії">
        <span class="comedianBioSourceIcon" aria-hidden="true"></span>
        <span>${escapeHtml(suffix)}</span>
      </div>
    `;
    bioEl.hidden = false;
    applyBioMobileToggle(bioEl);
  }

  function formatEventDate(raw, source){
    const value = String(raw || "").trim();
    if (!value) return "";

    // For concert listings we keep source-local wall time to avoid timezone shifts
    // caused by browser locale conversion (e.g. 19:00 becoming 22:00).
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
    if (m){
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const hh = Number(m[4] ?? "00");
      const mm = Number(m[5] ?? "00");
      const dateOnly = new Date(year, month - 1, day, hh, mm);

      // Karabas startDate values in current feed are shifted by +3h.
      // Correct display-time to match the actual event card time.
      if (String(source || "").toLowerCase() === "karabas"){
        dateOnly.setHours(dateOnly.getHours() - 3);
      }

      const dayMonth = dateOnly.toLocaleDateString("uk-UA", {
        day: "numeric",
        month: "long",
      });
      const hhOut = String(dateOnly.getHours()).padStart(2, "0");
      const mmOut = String(dateOnly.getMinutes()).padStart(2, "0");
      return `${dayMonth} о ${hhOut}:${mmOut}`;
    }

    const ms = parseDateMs(value);
    if (!ms) return "";
    return new Date(ms).toLocaleString("uk-UA", {
      day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"
    });
  }

  function renderPerformerEvents(){
    const eventsEl = qs("comedianEvents");
    if (!eventsEl) return;

    if (state.mode !== "performer" || !state.performer){
      eventsEl.hidden = true;
      eventsEl.innerHTML = "";
      return;
    }

    const events = Array.isArray(DATA.events?.[state.performer])
      ? DATA.events[state.performer]
      : [];
    if (!events.length){
      eventsEl.hidden = true;
      eventsEl.innerHTML = "";
      return;
    }

    eventsEl.hidden = false;
    eventsEl.innerHTML = `
      <div class="comedianEventsTitle">Найближчі концерти</div>
      <div class="comedianEventsList">
        ${events.map((event, index) => `
          <article class="comedianEvent${index > 0 ? " comedianEventAdditional" : ""}">
            <div class="comedianEventName">${escapeHtml(event.title)}</div>
            <div class="comedianEventMeta">📅 ${escapeHtml(formatEventDate(event.start, event.source))}</div>
            <div class="comedianEventMeta">📍 ${escapeHtml([event.city, event.venue].filter(Boolean).join(", "))}</div>
            <a class="comedianEventLink" href="${escapeAttr(event.url)}" target="_blank" rel="noopener noreferrer">🎟 Квитки: ${escapeHtml(event.source || "сайт події")}</a>
          </article>
        `).join("")}
      </div>
      ${events.length > 1 ? `<button class="comedianEventsToggle" type="button" aria-expanded="false">Більше...</button>` : ""}
    `;

    const toggle = eventsEl.querySelector(".comedianEventsToggle");
    if (toggle){
      toggle.addEventListener("click", () => {
        const expanded = toggle.getAttribute("aria-expanded") === "true";
        eventsEl.classList.toggle("comedianEventsExpanded", !expanded);
        toggle.setAttribute("aria-expanded", String(!expanded));
        toggle.textContent = expanded ? "Більше..." : "Менше";
      });
    }
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

  function createVideoCard(v, compact = false){
    const card = document.createElement("div");
    card.className = compact ? "card railCard" : "card";

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

    return card;
  }

  function setHomeModeVisibility(enabled){
    const home = qs("homeRows");
    if (home) home.hidden = !enabled;
  }

  function buildHomeRows(videos){
    const byDate = videos.slice().sort((a, b) => {
      const da = parseDateMs(getPublishedRaw(a)) || 0;
      const db = parseDateMs(getPublishedRaw(b)) || 0;
      return db - da;
    });

    const DAY = 24 * 60 * 60 * 1000;
    const sixMonthsAgo = Date.now() - 183 * DAY;
    const bestSixMonths = videos
      .filter(v => {
        const ms = parseDateMs(getPublishedRaw(v));
        return ms != null && ms >= sixMonthsAgo;
      })
      .sort((a, b) => getViews(b) - getViews(a));

    const forgottenClassics = videos
      .filter(v => {
        const ms = parseDateMs(getPublishedRaw(v));
        if (!ms) return false;
        const year = new Date(ms).getUTCFullYear();
        return year === 2022 || year === 2023;
      })
      .sort((a, b) => getViews(b) - getViews(a));

    const viewersChoice = videos
      .filter(v => getViews(v) >= 1000 && getLikes(v) > 0)
      .sort((a, b) => {
        const aRate = getLikes(a) / Math.max(1, getViews(a));
        const bRate = getLikes(b) / Math.max(1, getViews(b));
        if (bRate !== aRate) return bRate - aRate;
        return getViews(b) - getViews(a);
      });

    function byClub(rePattern){
      return videos
        .filter(v => rePattern.test(String(v?.channel_title || "")))
        .sort((a, b) => getViews(b) - getViews(a));
    }

    function uniqueByPerformer(items, limit){
      const result = [];
      const used = new Set();

      for (const item of items){
        const performer = String(getPerformer(item) || "").trim();
        const key = performer ? performer.toLowerCase() : `video:${getVideoId(item)}`;
        if (used.has(key)) continue;
        used.add(key);
        result.push(item);
        if (result.length >= limit) break;
      }

      return result;
    }

    const underground = byClub(/підпіль/i);
    const brodiachyi = byClub(/бродяч/i);
    const cherepakha = byClub(/череп/i);
    const standupBattleClub = byClub(/stand\s*up\s*battle\s*club|standup\s*battle\s*club|battle\s*club/i);

    return [
      {
        key: "best-6m",
        title: "Найкраще за пів року",
        subtitle: "Топ за переглядами за останні 6 місяців",
        items: bestSixMonths.slice(0, 10),
        visibleCount: 4,
        columns: 4,
      },
      {
        key: "forgotten-classics",
        title: "Забута класика",
        subtitle: "Найкращі відео 2022-2023",
        items: forgottenClassics.slice(0, 10),
        visibleCount: 4,
        columns: 4,
      },
      {
        key: "viewers-choice",
        title: "Вибір глядачів",
        subtitle: "Найвищий відсоток лайків",
        items: viewersChoice.slice(0, 10),
        visibleCount: 4,
        columns: 4,
      },
      {
        key: "club-underground",
        title: "Підпільний",
        subtitle: "",
        logo: CLUB_LOGOS.underground,
        items: uniqueByPerformer(underground, 10),
        visibleCount: 4,
        columns: 4,
      },
      {
        key: "club-brodiachyi",
        title: "Бродячий",
        subtitle: "",
        logo: CLUB_LOGOS.brodiachyi,
        items: uniqueByPerformer(brodiachyi, 10),
        visibleCount: 4,
        columns: 4,
      },
      {
        key: "club-cherepakha",
        title: "ЧерепаХА",
        subtitle: "",
        logo: CLUB_LOGOS.cherepakha,
        items: uniqueByPerformer(cherepakha, 10),
        visibleCount: 4,
        columns: 4,
      },
      {
        key: "club-battle",
        title: "Standup Battle Club",
        subtitle: "",
        logo: CLUB_LOGOS.battleClub,
        items: uniqueByPerformer(standupBattleClub, 10),
        visibleCount: 4,
        columns: 4,
      },
    ];
  }

  function renderHomeRows(videos){
    const host = qs("homeRows");
    if (!host) return false;

    host.innerHTML = "";
    const rows = buildHomeRows(videos || []);
    state.homeRowOffsets = state.homeRowOffsets || {};

    for (const row of rows){
      const rowSize = Math.max(1, Number(row.visibleCount || 10));
      const total = row.items.length;
      const visibleCount = Math.min(rowSize, total);
      const maxOffset = Math.max(0, total - 1);
      const safeOffset = Math.min(
        Math.max(0, Number(state.homeRowOffsets[row.key] || 0)),
        maxOffset
      );
      state.homeRowOffsets[row.key] = safeOffset;

      const visibleItems = [];
      for (let i = 0; i < visibleCount; i++){
        const idx = (safeOffset + i) % total;
        visibleItems.push(row.items[idx]);
      }

      const section = document.createElement("section");
      section.className = "homeRow";
      section.setAttribute("aria-label", row.title);

      const header = document.createElement("header");
      header.className = "homeRowHeader";
      header.innerHTML = `
        <div class="homeRowTitleWrap${row.subtitle ? "" : " noSubtitle"}">
          <h2 class="homeRowTitle">
            ${row.logo ? `<img class="homeRowLogo" src="${escapeAttr(row.logo)}" alt="${escapeAttr(row.title)} logo" />` : ""}
            <span>${escapeHtml(row.title)}</span>
          </h2>
          ${row.subtitle ? `<p class="homeRowSubtitle">${escapeHtml(row.subtitle)}</p>` : ""}
        </div>
      `;

      const actions = document.createElement("div");
      actions.className = "homeRowActions";

      const viewport = document.createElement("div");
      viewport.className = "homeRailViewport";

      const prevBtn = document.createElement("button");
      prevBtn.className = "railNav railNavPrev";
      prevBtn.type = "button";
      prevBtn.setAttribute("aria-label", `Прокрутити ${row.title} ліворуч`);
      prevBtn.textContent = "‹";
      prevBtn.disabled = total <= 1;
      prevBtn.dataset.dir = "prev";

      const nextBtn = document.createElement("button");
      nextBtn.className = "railNav railNavNext";
      nextBtn.type = "button";
      nextBtn.setAttribute("aria-label", `Прокрутити ${row.title} праворуч`);
      nextBtn.textContent = "›";
      nextBtn.disabled = total <= 1;
      nextBtn.dataset.dir = "next";

      actions.appendChild(prevBtn);
      actions.appendChild(nextBtn);
      header.appendChild(actions);

      const track = document.createElement("div");
      track.className = "homeRail";
      track.id = `home-rail-${row.key}`;
      const columns = Math.max(1, Number(row.columns || visibleCount));
      track.style.setProperty("--row-columns", String(columns));

      if (!visibleItems.length){
        const empty = document.createElement("div");
        empty.className = "homeRowEmpty";
        empty.textContent = "Поки немає відео для цієї підбірки.";
        track.appendChild(empty);
      } else {
        for (const item of visibleItems){
          track.appendChild(createVideoCard(item, true));
        }
      }

      function animateTrack(direction){
        const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (prefersReduced) return;
        track.classList.remove("isAnimatingPrev", "isAnimatingNext");
        // Force reflow so repeated clicks retrigger animation.
        void track.offsetWidth;
        track.classList.add(direction === "prev" ? "isAnimatingPrev" : "isAnimatingNext");
      }

      prevBtn.addEventListener("click", () => {
        if (total <= 1) return;
        animateTrack("prev");
        state.homeRowOffsets[row.key] =
          (Number(state.homeRowOffsets[row.key] || 0) - 1 + total) % total;
        window.setTimeout(() => renderHomeRows(DATA.videos || []), 140);
      });
      nextBtn.addEventListener("click", () => {
        if (total <= 1) return;
        animateTrack("next");
        state.homeRowOffsets[row.key] =
          (Number(state.homeRowOffsets[row.key] || 0) + 1) % total;
        window.setTimeout(() => renderHomeRows(DATA.videos || []), 140);
      });

      viewport.appendChild(track);

      section.appendChild(header);
      section.appendChild(viewport);
      host.appendChild(section);
    }

    return true;
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
      grid.appendChild(createVideoCard(v));
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
    const suggestionsEl = qs("performerSuggestions");

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
      if (suggestionsEl){
        if (String(state.search || "").trim().length > 0) searchEl.setAttribute("list", "performerSuggestions");
        else searchEl.removeAttribute("list");
      }

      let t = null;
      searchEl.addEventListener("input", () => {
        state.search = searchEl.value;
        if (suggestionsEl){
          if (String(searchEl.value || "").trim().length > 0) searchEl.setAttribute("list", "performerSuggestions");
          else searchEl.removeAttribute("list");
        }
        state.page = 1;
        syncUrl();
        clearTimeout(t);
        t = setTimeout(render, 120);
      });
    }
  }

  function renderSimilarComedians(){
    const el = qs("similarComedians");
    if (!el) return;

    if (state.mode !== "performer" || !state.performer){
      el.hidden = true;
      return;
    }

    const recs = DATA.recommendations?.[state.performer];
    if (!recs || Object.keys(recs).length === 0){
      el.hidden = true;
      return;
    }

    const top5 = Object.entries(recs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    el.hidden = false;
    el.innerHTML = `
      <div class="similarTitle">Схожі коміки</div>
      <div class="similarList">
        ${top5.map(([name]) => `
          <a class="similarItem" href="comedian.html?p=${encodeURIComponent(name)}">
            <span class="similarName">${escapeHtml(name)}</span>
          </a>
        `).join("")}
      </div>
    `;
  }


  function render(){
    state.pageSize = (state.mode === "all") ? 8 : 10;

    let filtered = applyFilters(DATA.videos || []);
    filtered = applySort(filtered);

    if (state.mode === "all"){
      setHomeModeVisibility(true);
      renderHomeRows(DATA.videos || []);
    } else {
      setHomeModeVisibility(false);
    }

    if (state.mode === "performer"){
      renderPerformerCard(filtered);
    }
    renderPerformerBio();
    renderPerformerEvents();
    renderSimilarComedians();

    const { slice, total, pages } = paginate(filtered);
    renderGrid(slice, total);
    renderPagination(pages, total);
  }

  async function loadJson(path){
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
    return await r.json();
  }

  async function loadText(path){
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
    return await r.text();
  }

  async function loadJsonAny(paths){
    let lastError = null;
    for (const path of paths){
      try {
        return await loadJson(path);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Failed to load JSON from all provided paths");
  }

  function parsePerformersFile(text){
    const performers = {};
    const lines = text.split("\n").filter(l => l.trim());
    for (const line of lines){
      const parts = line.split("|").map(p => p.trim());
      if (parts.length === 0) continue;
      
      const primaryName = parts[0];
      let instagram = null;
      
      // Search for Instagram link anywhere in the line
      for (const part of parts){
        if (part.includes("instagram.com")){
          instagram = part;
          break;
        }
      }

      const aliases = parts.filter(part => part && !/^https?:\/\//i.test(part));
      
      performers[primaryName] = { instagram, aliases };
    }
    return performers;
  }

  function renderSearchSuggestions(){
    const datalist = qs("performerSuggestions");
    if (!datalist) return;

    const names = new Set();
    for (const [primaryName, meta] of Object.entries(DATA.performers || {})){
      if (primaryName) names.add(primaryName);
      const aliases = Array.isArray(meta?.aliases) ? meta.aliases : [];
      for (const alias of aliases){
        if (alias) names.add(alias);
      }
    }

    const sortedNames = [...names].sort((a, b) => a.localeCompare(b, "uk"));
    datalist.innerHTML = sortedNames
      .map(name => `<option value="${escapeAttr(name)}"></option>`)
      .join("");
  }

  // ---------- INIT pages ----------
  async function init({mode, performer}){
    state.mode = mode;
    state.performer = performer;

    readUrl();

    const [videos, rating, performersText, bios, recommendations, events] = await Promise.all([
      loadJson("data/videos.json"),
      loadJson("data/rating.json"),
      loadText("performers.txt").catch(() => ""),
      loadJsonAny(["comedians_bios.json", "../comedians_bios.json"]).catch(() => ({})),
      loadJson("data/recommendations.json").catch(() => ({})),
      loadJson("data/events.json").catch(() => ({})),
    ]);

    DATA.videos = videos || [];
    DATA.rating = rating || [];
    DATA.performers = parsePerformersFile(performersText);
    DATA.bios = bios || {};
    DATA.biosIndex = buildBiosIndex(DATA.bios);
    DATA.recommendations = recommendations || {};
    DATA.events = events || {};

    renderSidebar();
    renderSearchSuggestions();
    bindControls();
    render();
  }

  async function initRating(){
    const rating = await loadJson("data/rating.json");
    let ratingByYear = null;
    try {
      ratingByYear = await loadJson("data/rating_by_year.json");
    } catch (err) {
      ratingByYear = null;
    }
    DATA.rating = rating || [];
    DATA.ratingByYear = ratingByYear || { all: DATA.rating };
    renderSidebar();

    const table = qs("ratingTable");
    const search = qs("ratingSearch");
    const yearSel = qs("ratingYear");
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

    function getCurrentRows(){
      const key = String(state.year || "all");
      const rows = Array.isArray(DATA.ratingByYear?.[key]) ? DATA.ratingByYear[key].slice() : [];
      return rows;
    }

    function cmp(a,b){
      const col = columns.find(c=>c.key===sortKey) || columns[0];
      const av = a?.[sortKey], bv = b?.[sortKey];
      let res = 0;

      if (col.type === "num") res = (Number(av||0) - Number(bv||0));
      else res = String(av||"").localeCompare(String(bv||""), "uk");

      return sortDir === "asc" ? res : -res;
    }

    function filteredRows(){
      let rows = getCurrentRows();
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
              return `<th data-key="${escapeAttr(c.key)}" class="${active ? "isSorted" : ""}" data-dir="${active ? sortDir : ""}">
                ${escapeHtml(c.label)}<span class="sortHint" aria-hidden="true"></span>
              </th>`;
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

    if (yearSel){
      yearSel.addEventListener("change", () => {
        state.year = yearSel.value || "all";
        renderTable();
      });
    }

    renderTable();
  }

  // ✅ NEW: comedians page renderer
  async function initComedians(){
    const rating = await loadJson("data/rating.json");
    DATA.rating = rating || [];
    renderSidebar();

    const grid = qs("comediansGrid");
    const search = qs("comediansSearch");
    const sortSel = qs("comediansSort");
    if (!grid) return;

    let q = "";
    let sort = (sortSel && sortSel.value) ? sortSel.value : "rank_asc";

    function sortedRows(){
      let rows = (DATA.rating || []).slice();

      const qq = String(q||"").trim().toLowerCase();
      if (qq){
        rows = rows.filter(r => String(r.performer||"").toLowerCase().includes(qq));
      }

      const byNum = (k, dir) => (a,b) => dir*(Number(a?.[k]||0) - Number(b?.[k]||0));
      const byText = (k, dir) => (a,b) => dir*String(a?.[k]||"").localeCompare(String(b?.[k]||""), "uk");

      if (sort === "rank_asc") rows.sort(byNum("rank", +1));
      else if (sort === "views_desc") rows.sort(byNum("total_views", -1));
      else if (sort === "peak_desc") rows.sort(byNum("peak_views", -1));
      else if (sort === "videos_desc") rows.sort(byNum("video_count", -1));
      else if (sort === "like_desc") rows.sort(byNum("like_rate_smooth_pct", -1));
      else if (sort === "name_asc") rows.sort(byText("performer", +1));
      else rows.sort(byNum("rank", +1));

      return rows;
    }

    function renderGrid(){
      const rows = sortedRows();

      if (rows.length === 0){
        grid.innerHTML = `
          <div class="aboutCard" style="grid-column:1/-1;">
            <h2 style="margin:0 0 8px;">Нічого не знайдено</h2>
            <p style="margin:0;color:var(--muted);">Спробуй інший запит.</p>
          </div>
        `;
        return;
      }

      grid.innerHTML = rows.map(r => {
        const p = r.performer || "";
        return `
          <a class="comedianCard" href="./comedian.html?p=${encodeURIComponent(p)}">
            <div class="comedianTop">
              <div class="comedianName">${escapeHtml(p)}</div>
              <div class="comedianRank">#${escapeHtml(r.rank)}</div>
            </div>
            <div class="comedianMeta">
              <span class="badge">${fmtNum(r.total_views)} views</span>
              <span class="badge">${fmtNum(r.video_count)} відео</span>
              <span class="badge">peak ${fmtNum(r.peak_views)}</span>
              <span class="badge">like ${Number(r.like_rate_smooth_pct||0).toFixed(2)}%</span>
            </div>
          </a>
        `;
      }).join("");
    }

    if (search){
      search.addEventListener("input", () => {
        q = search.value || "";
        renderGrid();
      });
    }

    if (sortSel){
      sortSel.addEventListener("change", () => {
        sort = sortSel.value || "rank_asc";
        renderGrid();
      });
    }

    renderGrid();
  }

  async function initAbout(){
    const rating = await loadJson("data/rating.json");
    DATA.rating = rating || [];
    renderSidebar();
  }

  return { init, initRating, initComedians, initAbout };
})();
