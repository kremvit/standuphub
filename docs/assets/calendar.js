(() => {
  const $ = (id) => document.getElementById(id);
  const videoError = new Promise((resolve, reject) => {
    window.addEventListener("standuphub:videos-loaded", (event) => resolve(event.detail.videos), { once: true });
    window.addEventListener("standuphub:videos-error", (event) => reject(event.detail.error), { once: true });
  });
  const state = {
    videos: [],
    events: [],
    mode: "videos",
    year: new Date().getFullYear(),
    performer: "",
    club: "",
    wholeYear: false,
    selectedDate: "",
  };
  const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
  const monthNames = Array.from({ length: 12 }, (_, month) =>
    new Intl.DateTimeFormat("uk-UA", { month: "long" }).format(new Date(2020, month, 1))
  );
  const numberFormat = new Intl.NumberFormat("uk-UA");

  function parseDate(value){
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function videoDate(video){
    const raw = video?.published_at ?? video?.publishedAt ?? video?.published ?? video?.published_date ?? video?.date ?? "";
    const date = parseDate(raw);
    return date ? localDateKey(date) : "";
  }

  function localDateKey(date){
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function dateFromKey(key){
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function dateKeyInYear(year, month, day){
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function getRange(){
    const year = Number(state.year);
    if (state.mode === "events" && !state.wholeYear){
      const now = new Date();
      const firstMonth = year === now.getFullYear() ? now.getMonth() : 0;
      const start = new Date(year, firstMonth, 1);
      const end = new Date(year, firstMonth + 3, 1);
      return { start, end };
    }
    return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
  }

  function filteredItems(){
    const { start, end } = getRange();
    const startKey = localDateKey(start);
    const endKey = localDateKey(end);
    if (state.mode === "videos"){
      return state.videos.flatMap((video) => {
        const key = videoDate(video);
        const performer = String(video.performer || video.comedian || video.author || "");
        const channel = String(video.channel_title || "");
        if (!key || key < startKey || key >= endKey) return [];
        if (state.performer && performer !== state.performer) return [];
        if (state.club && channel !== state.club) return [];
        return [{ key, item: video }];
      });
    }
    const now = Date.now();
    return state.events.flatMap((event) => {
      if (event.startMs < now || event.key < startKey || event.key >= endKey) return [];
      if (state.performer && !event.performers.includes(state.performer)) return [];
      if (state.club && String(event.venue || "") !== state.club) return [];
      return [{ key: event.key, item: event }];
    });
  }

  function makeButton(key, count, maxCount){
    const button = document.createElement("button");
    const dayItems = state.dayItems.get(key) || [];
    const date = dateFromKey(key);
    const dateLabel = date.toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });
    const duration = state.mode === "videos"
      ? dayItems.reduce((sum, item) => sum + (Number(item.duration_sec || item.durationSec || item.duration_seconds || 0) || 0), 0)
      : 0;
    button.type = "button";
    button.className = "calendarDay";
    button.dataset.date = key;
    button.dataset.level = count ? String(Math.max(1, Math.ceil(count / maxCount * 4))) : "0";
    button.title = state.mode === "videos"
      ? `${dateLabel} · ${count} відео · ${formatDuration(duration)}`
      : `${dateLabel} · ${formatEventCount(count)}`;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(key === state.selectedDate));
    if (count){
      button.textContent = String(date.getDate());
    } else {
      button.disabled = true;
      button.tabIndex = -1;
    }
    if (key === state.selectedDate) button.classList.add("isSelected");
    if (count) button.addEventListener("click", () => selectDate(key, true));
    return button;
  }

  function formatDuration(seconds){
    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (!hours) return `${numberFormat.format(remainder)} хв`;
    return remainder ? `${numberFormat.format(hours)} год ${numberFormat.format(remainder)} хв` : `${numberFormat.format(hours)} год`;
  }

  function formatEventCount(count){
    const lastTwo = count % 100;
    if (count % 10 === 1 && lastTwo !== 11) return `${count} подія`;
    if (count % 10 >= 2 && count % 10 <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} події`;
    return `${count} подій`;
  }

  function renderHeatmap(counts){
    const heatmap = $("calendarHeatmap");
    const monthsView = $("calendarMonthView");
    heatmap.innerHTML = "";
    monthsView.innerHTML = "";
    const { start, end } = getRange();
    const maxCount = Math.max(1, ...counts.values());
    let month = new Date(start.getFullYear(), start.getMonth(), 1);
    while (month < end){
      const monthYear = month.getFullYear();
      const monthIndex = month.getMonth();
      const monthDays = new Date(monthYear, monthIndex + 1, 0).getDate();
      const offset = (month.getDay() + 6) % 7;
      const weekCount = Math.ceil((offset + monthDays) / 7);

      const block = document.createElement("section");
      block.className = "calendarMonthBlock";
      const blockTitle = document.createElement("div");
      blockTitle.className = "calendarMonthLabel";
      blockTitle.textContent = `${monthNames[monthIndex]} ${monthYear}`;
      block.appendChild(blockTitle);
      const monthContent = document.createElement("div");
      monthContent.className = "calendarMonthContent";
      if (month.getTime() === new Date(start.getFullYear(), start.getMonth(), 1).getTime()){
        const weekdayLabels = document.createElement("div");
        weekdayLabels.className = "calendarWeekdayLabels";
        for (const weekday of weekdays){
          const label = document.createElement("span");
          label.textContent = weekday;
          weekdayLabels.appendChild(label);
        }
        monthContent.appendChild(weekdayLabels);
      }
      const weeks = document.createElement("div");
      weeks.className = "calendarMonthWeeks";
      for (let weekIndex = 0; weekIndex < weekCount; weekIndex++){
        const week = document.createElement("div");
        week.className = "calendarWeek";
        for (let weekday = 0; weekday < 7; weekday++){
          const day = weekIndex * 7 + weekday - offset + 1;
          if (day < 1 || day > monthDays){
            const blank = document.createElement("span");
            blank.className = "calendarDay calendarDayBlank";
            blank.setAttribute("aria-hidden", "true");
            week.appendChild(blank);
          } else {
            const key = dateKeyInYear(monthYear, monthIndex, day);
            week.appendChild(makeButton(key, counts.get(key) || 0, maxCount));
          }
        }
        weeks.appendChild(week);
      }
      monthContent.appendChild(weeks);
      block.appendChild(monthContent);
      heatmap.appendChild(block);

      const monthEl = document.createElement("section");
      monthEl.className = "calendarMonth";
      monthEl.dataset.month = `${monthYear}-${String(monthIndex + 1).padStart(2, "0")}`;
      const title = document.createElement("div");
      title.className = "calendarMonthTitle";
      title.textContent = `${monthNames[month.getMonth()]} ${month.getFullYear()}`;
      monthEl.appendChild(title);
      const grid = document.createElement("div");
      grid.className = "calendarMonthGrid";
      for (const weekday of weekdays){
        const heading = document.createElement("span");
        heading.className = "calendarWeekday";
        heading.textContent = weekday;
        grid.appendChild(heading);
      }
      for (let i = 0; i < offset; i++){
        const blank = document.createElement("span");
        grid.appendChild(blank);
      }
      for (let day = 1; day <= monthDays; day++){
        const key = dateKeyInYear(month.getFullYear(), month.getMonth(), day);
        if (key < localDateKey(start) || key >= localDateKey(end)){
          const blank = document.createElement("span");
          grid.appendChild(blank);
        } else {
          grid.appendChild(makeButton(key, counts.get(key) || 0, maxCount));
        }
      }
      monthEl.appendChild(grid);
      const inlineDetails = document.createElement("div");
      inlineDetails.className = "calendarInlineDetails";
      inlineDetails.hidden = true;
      monthEl.appendChild(inlineDetails);
      monthsView.appendChild(monthEl);
      month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    }
  }

  function renderSummary(items, byMonth, byDay){
    const totalDuration = state.mode === "videos"
      ? items.reduce((sum, entry) => sum + (Number(entry.item.duration_sec || entry.item.durationSec || entry.item.duration_seconds || 0) || 0), 0)
      : null;
    let busiestMonth = "";
    let busiestCount = 0;
    for (const [key, count] of byMonth){
      if (count > busiestCount){
        busiestMonth = key;
        busiestCount = count;
      }
    }
    const monthLabel = busiestMonth
      ? `${monthNames[Number(busiestMonth.slice(5, 7)) - 1]} ${busiestMonth.slice(0, 4) === String(state.year) ? "" : busiestMonth.slice(0, 4)}`.trim()
      : "—";
    const cards = state.mode === "videos"
      ? [
          ["Відео за рік", numberFormat.format(items.length)],
          ["Загальна тривалість", formatDuration(totalDuration)],
          ["Днів із прем’єрами", numberFormat.format(byDay.size)],
          ["Найактивніший місяць", monthLabel],
        ]
      : [
          ["Подій в афіші", numberFormat.format(items.length)],
          ["Найближча дата", byDay.size ? dateFromKey([...byDay.keys()].sort()[0]).toLocaleDateString("uk-UA", { day: "numeric", month: "long" }) : "—"],
          ["Днів із подіями", numberFormat.format(byDay.size)],
          ["Найактивніший місяць", monthLabel],
        ];
    const container = $("calendarSummary");
    container.innerHTML = "";
    for (const [label, value] of cards){
      const card = document.createElement("div");
      card.className = "calendarSummaryCard";
      const labelEl = document.createElement("div");
      labelEl.className = "calendarSummaryLabel";
      labelEl.textContent = label;
      const valueEl = document.createElement("div");
      valueEl.className = "calendarSummaryValue";
      valueEl.textContent = value;
      card.append(labelEl, valueEl);
      container.appendChild(card);
    }
  }

  function appendDetailCard(list, entry){
    const item = entry.item;
    const isVideo = state.mode === "videos";
    const id = String(item.video_id || item.videoId || item.id || "");
    const href = isVideo ? (item.url || (id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : "")) : item.url;
    const card = document.createElement(href ? "a" : "article");
    card.className = "calendarDetailCard";
    if (href){
      card.href = href;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
    }
    const image = document.createElement("img");
    image.className = "calendarDetailThumb";
    image.alt = "";
    image.loading = "lazy";
    image.src = isVideo && id
      ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`
      : String(item.poster || "");
    if (!image.src || image.src === location.href){
      image.replaceWith(makePlaceholder(isVideo ? "Відео" : "Афіша"));
    } else {
      image.addEventListener("error", () => image.replaceWith(makePlaceholder(isVideo ? "Відео" : "Афіша")), { once: true });
    }
    const body = document.createElement("div");
    body.className = "calendarDetailBody";
    const title = document.createElement("div");
    title.className = "calendarDetailTitle";
    title.textContent = String(isVideo ? (item.title || item.name || "") : item.title || "Подія");
    const meta = document.createElement("div");
    meta.className = "calendarDetailMeta";
    if (isVideo){
      meta.textContent = `${String(item.performer || item.comedian || item.author || item.channel_title || "")} · ${formatDuration(Number(item.duration_sec || item.durationSec || item.duration_seconds || 0) || 0)}`;
    } else {
      const time = new Date(item.startMs).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
      meta.textContent = [time, item.city, item.venue, item.performers.join(", ")].filter(Boolean).join(" · ");
    }
    body.append(title, meta);
    card.append(image, body);
    list.appendChild(card);
  }

  function makePlaceholder(text){
    const placeholder = document.createElement("span");
    placeholder.className = "calendarDetailThumb";
    placeholder.textContent = text;
    placeholder.setAttribute("aria-hidden", "true");
    return placeholder;
  }

  function renderDetailsInto(details, isInline = false){
    details.innerHTML = "";
    if (!state.selectedDate){
      if (isInline){
        details.hidden = true;
        return;
      }
      const empty = document.createElement("div");
      empty.className = "calendarDetailsEmpty";
      empty.textContent = "Натисніть на позначений день, щоб переглянути його вміст.";
      details.appendChild(empty);
      return;
    }
    details.hidden = false;
    const title = document.createElement("div");
    title.className = "calendarDetailsTitle";
    title.textContent = dateFromKey(state.selectedDate).toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });
    details.appendChild(title);
    const items = state.dayItems.get(state.selectedDate) || [];
    if (!items.length){
      const empty = document.createElement("div");
      empty.className = "calendarDetailsEmpty";
      empty.textContent = state.mode === "events"
        ? "У нашій афіші на цей день немає майбутніх подій."
        : "Цього дня відео не виходили.";
      details.appendChild(empty);
      return;
    }
    const list = document.createElement("div");
    list.className = "calendarDetailList";
    for (const item of items) appendDetailCard(list, { item });
    details.appendChild(list);
  }

  function renderDetails(){
    renderDetailsInto($("calendarDayDetails"));
    document.querySelectorAll(".calendarInlineDetails").forEach((details) => {
      const month = details.closest(".calendarMonth");
      const isSelectedMonth = state.selectedDate && month.dataset.month === state.selectedDate.slice(0, 7);
      if (isSelectedMonth) renderDetailsInto(details, true);
      else {
        details.innerHTML = "";
        details.hidden = true;
      }
    });
  }

  function updateSubtitle(){
    if (state.mode === "videos"){
      $("calendarSubtitle").textContent = "Коли виходили українські стендап-відео";
      return;
    }
    const now = new Date();
    const range = state.wholeYear
      ? "весь вибраний рік"
      : state.year === now.getFullYear() ? "поточний місяць і два наступні" : "перші три місяці вибраного року";
    $("calendarSubtitle").textContent = `Майбутні події з нашої афіші · показано ${range}. Порожній день означає, що подій не знайдено в афіші.`;
  }

  function selectDate(key, revealDetails = false){
    state.selectedDate = key;
    document.querySelectorAll(".calendarDay[data-date]").forEach((button) => {
      const selected = button.dataset.date === key;
      button.classList.toggle("isSelected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    renderDetails();
    if (revealDetails && key && matchMedia("(max-width: 700px)").matches){
      document.querySelector(".calendarInlineDetails:not([hidden])")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function render(){
    const items = filteredItems();
    const dayItems = new Map();
    const monthCounts = new Map();
    const counts = new Map();
    for (const entry of items){
      if (!dayItems.has(entry.key)) dayItems.set(entry.key, []);
      dayItems.get(entry.key).push(entry.item);
      counts.set(entry.key, (counts.get(entry.key) || 0) + 1);
      const monthKey = entry.key.slice(0, 7);
      monthCounts.set(monthKey, (monthCounts.get(monthKey) || 0) + 1);
    }
    state.dayItems = dayItems;
    renderSummary(items, monthCounts, dayItems);
    renderHeatmap(counts);
    if (state.selectedDate && !dayItems.has(state.selectedDate)) state.selectedDate = "";
    selectDate(state.selectedDate);
  }

  function addFilterOptions(select, values, placeholder){
    const previousValue = select.value;
    select.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = placeholder;
    select.appendChild(allOption);
    for (const value of [...values].filter(Boolean).sort((a, b) => a.localeCompare(b, "uk"))){
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    select.value = [...select.options].some((option) => option.value === previousValue) ? previousValue : "";
  }

  function normalizeEvents(data){
    const byId = new Map();
    for (const [performer, items] of Object.entries(data || {})){
      if (!Array.isArray(items)) continue;
      for (const item of items){
        const startMs = Date.parse(item?.start || "");
        if (!Number.isFinite(startMs)) continue;
        const key = String(item.start).slice(0, 10);
        const identity = item.url || [item.start, item.title, item.city, item.venue].join("|");
        if (!byId.has(identity)){
          byId.set(identity, { ...item, key, startMs, performers: [] });
        }
        const event = byId.get(identity);
        if (!event.performers.includes(performer)) event.performers.push(performer);
      }
    }
    return [...byId.values()];
  }

  async function init(){
    const errorEl = $("calendarError");
    try {
      const [videos, eventData] = await Promise.all([
        videoError,
        fetch("data/events.json", { cache: "no-cache" }).then((response) => {
          if (!response.ok) throw new Error(`Не вдалося завантажити афішу: HTTP ${response.status}`);
          return response.json();
        }),
      ]);
      state.videos = Array.isArray(videos) ? videos : [];
      state.events = normalizeEvents(eventData);
      const years = new Set([state.year]);
      for (const video of state.videos){
        const key = videoDate(video);
        if (key) years.add(Number(key.slice(0, 4)));
      }
      for (const event of state.events) years.add(Number(event.key.slice(0, 4)));
      const yearSelect = $("calendarYear");
      for (const year of [...years].sort((a, b) => b - a)){
        const option = document.createElement("option");
        option.value = String(year);
        option.textContent = String(year);
        yearSelect.appendChild(option);
      }
      yearSelect.value = String(state.year);
      addFilterOptions(
        $("calendarPerformer"),
        new Set([
          ...state.videos.map((video) => String(video.performer || video.comedian || video.author || "")),
          ...state.events.flatMap((event) => event.performers),
        ]),
        "Усі коміки"
      );
      addFilterOptions(
        $("calendarClub"),
        new Set([
          ...state.videos.map((video) => String(video.channel_title || "")),
          ...state.events.map((event) => String(event.venue || "")),
        ]),
        "Усі клуби / канали"
      );
      document.querySelectorAll("[data-calendar-mode]").forEach((button) => {
        button.addEventListener("click", () => {
          state.mode = button.dataset.calendarMode;
          state.wholeYear = false;
          state.selectedDate = "";
          document.querySelectorAll("[data-calendar-mode]").forEach((modeButton) =>
            modeButton.setAttribute("aria-pressed", String(modeButton === button))
          );
          updateSubtitle();
          const isEvents = state.mode === "events";
          $("calendarRangeToggle").hidden = !isEvents;
          render();
        });
      });
      yearSelect.addEventListener("change", () => {
        state.year = Number(yearSelect.value);
        state.wholeYear = false;
        state.selectedDate = "";
        updateSubtitle();
        render();
      });
      $("calendarPerformer").addEventListener("change", (event) => {
        state.performer = event.target.value;
        state.selectedDate = "";
        render();
      });
      $("calendarClub").addEventListener("change", (event) => {
        state.club = event.target.value;
        state.selectedDate = "";
        render();
      });
      $("calendarRangeToggle").addEventListener("click", (event) => {
        state.wholeYear = !state.wholeYear;
        event.currentTarget.textContent = state.wholeYear ? "Показати найближчі 3 місяці" : "Показати весь рік";
        state.selectedDate = "";
        updateSubtitle();
        render();
      });
      updateSubtitle();
      render();
    } catch (error){
      errorEl.hidden = false;
      errorEl.textContent = `Не вдалося завантажити календар: ${error.message || error}`;
    }
  }

  window.StandupCalendar = {
    setVideos(videos){
      window.dispatchEvent(new CustomEvent("standuphub:videos-loaded", { detail: { videos } }));
    },
    setVideoError(error){
      window.dispatchEvent(new CustomEvent("standuphub:videos-error", { detail: { error } }));
    },
  };
  init();
})();
