/* IceIQ: small, framework-free UI. All statistics come from our Flask API. */
"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const signed = (value) => value > 0 ? `+${value}` : String(value);
const numeric = (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : "—";
const colors = { ice: "#8ed5ff", orange: "#ffbcbf", muted: "#bdc8d1", grid: "#3e484f", green: "#8ed5ff" };
const state = {
  standings: null, conference: "Eastern", division: "Atlantic", view: "division", showAll: false, page: "dashboard", vizMode: "league",
  selected: { "team-first": null, "team-second": null, "player-first": null, "player-second": null },
  comparisons: { teams: null, players: null }, sequences: { teams: 0, players: 0 },
  charts: {}, defaultPlayersStarted: false,
};

function image(url, alt, className = "") {
  // The NHL's images are the only external resources used by the interface.
  const safe = typeof url === "string" && url.startsWith("https://assets.nhle.com/");
  return `<img src="${safe ? escapeHTML(url) : "/static/favicon.svg"}" alt="${escapeHTML(alt)}" class="${className}" loading="lazy">`;
}

document.addEventListener("error", (event) => {
  if (event.target instanceof HTMLImageElement && !event.target.classList.contains("no-image")) {
    event.target.classList.add("no-image");
    event.target.src = "/static/favicon.svg";
  }
}, true);

async function api(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(path, { signal: controller.signal, headers: { Accept: "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The data couldn't be loaded. Please try again.");
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("This request is taking too long. Please try again.");
    if (error instanceof TypeError) throw new Error("Can't reach the dashboard. Check that Flask is running and try again.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 4500);
}

function showError(id, message, retry = false) {
  const element = $(id);
  element.hidden = !message;
  element.innerHTML = message ? `${icon("info")}<span>${escapeHTML(message)}</span>${retry ? '<button class="text-button" id="retry-data">Try again</button>' : ""}` : "";
}

function emptyState(title, message, destination = "", linkText = "") {
  return `<div class="panel empty-state">${icon("chart")}<h2>${escapeHTML(title)}</h2><p>${escapeHTML(message)}</p>${destination ? `<a class="primary-button" href="#${destination}">${escapeHTML(linkText)}${icon("arrow")}</a>` : ""}</div>`;
}

function setSidebar(open) {
  const wasOpen = $("#sidebar").classList.contains("open");
  $("#sidebar").classList.toggle("open", open);
  $("#sidebar-backdrop").classList.toggle("open", open);
  $("#menu-button").setAttribute("aria-expanded", String(open));
  $("#sidebar").inert = !open && matchMedia("(max-width: 800px)").matches;
  if (open) $("#sidebar-close").focus();
  else if (wasOpen && matchMedia("(max-width: 800px)").matches) $("#menu-button").focus();
}

function navigate() {
  const requested = location.hash.slice(1) || "dashboard";
  if (requested === "main") return;
  const profileMatch = /^player\/(\d+)$/.exec(requested);
  const page = profileMatch ? "profile" : ["dashboard", "search", "teams", "players", "visualizations"].includes(requested) ? requested : "dashboard";
  state.page = page;
  $$(".page").forEach((element) => {
    element.hidden = element.id !== `page-${page}`;
    element.classList.toggle("active", !element.hidden);
  });
  $$(".nav-item").forEach((element) => {
    const active = element.dataset.page === (page === "profile" ? "search" : page);
    element.classList.toggle("active", active);
    if (active) element.setAttribute("aria-current", "page");
    else element.removeAttribute("aria-current");
  });
  const names = { dashboard: "Standings", search: "Player search", profile: "Player profile", teams: "Team comparison", players: "Player comparison", visualizations: "Visualizations" };
  $("#breadcrumb-current").textContent = names[page];
  $(".sidebar-version > span").textContent = `${String(["dashboard", "search", "teams", "players", "visualizations"].indexOf(page === "profile" ? "search" : page) + 1).padStart(2, "0")} / 05`;
  document.title = `${names[page]} — PuckPulse`;
  setSidebar(false);
  if (page === "players" && state.standings && !state.defaultPlayersStarted) loadDefaultPlayers();
  if (page === "visualizations") renderVisualizations();
  if (page === "search" && !browserState.loaded) loadPlayerBrowser();
  if (profileMatch) loadPlayerProfile(Number(profileMatch[1]));
  if (page !== "profile") browserState.profileSequence++;
  requestAnimationFrame(() => Object.values(state.charts).forEach((chart) => chart.resize()));
}

function setupChartDefaults() {
  if (!window.Chart) return;
  Chart.defaults.color = colors.muted;
  Chart.defaults.font.family = "Manrope, -apple-system, sans-serif";
  Chart.defaults.font.size = 10;
  Chart.defaults.borderColor = colors.grid;
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = "#262a33";
  Chart.defaults.plugins.tooltip.titleColor = "#eef4fb";
  Chart.defaults.plugins.tooltip.bodyColor = "#c7d6e6";
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.cornerRadius = 7;
  Chart.defaults.plugins.tooltip.displayColors = false;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) Chart.defaults.animation = false;
  Chart.register({ id: "darkBackground", beforeDraw(chart) {
    const ctx = chart.ctx;
    ctx.save(); ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "#1c2028";
    ctx.fillRect(0, 0, chart.width, chart.height); ctx.restore();
  } });
}

function destroyChart(id) {
  if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
}

function chart(id, type, data, options = {}) {
  destroyChart(id);
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (!window.Chart) {
    canvas.parentElement.innerHTML = '<p class="chart-unavailable">Charts could not load. Reload the page to try again. All statistics are still available in the tables.</p>';
    return;
  }
  state.charts[id] = new Chart(canvas, { type, data, options: { responsive: true, maintainAspectRatio: false, ...options } });
}

function standardScales(horizontal = false) {
  return {
    x: { border: { display: false }, grid: { display: !horizontal, color: "#24314688" }, ticks: { color: colors.muted, padding: 8, font: { size: 9 }, precision: 0 }, ...(horizontal ? { beginAtZero: true } : {}) },
    y: { border: { display: false }, grid: { display: horizontal, color: "#24314688" }, ticks: { color: colors.muted, padding: 8, font: { size: 9 }, precision: 0 }, ...(!horizontal ? { beginAtZero: true } : {}) },
  };
}

function renderSummary() {
  const teams = state.standings.teams;
  const played = teams.filter((team) => team.gamesPlayed > 0);
  const leader = teams[0];
  const offense = [...played].sort((a, b) => b.goalsFor / b.gamesPlayed - a.goalsFor / a.gamesPlayed)[0];
  const defense = [...played].sort((a, b) => a.goalsAgainst / a.gamesPlayed - b.goalsAgainst / b.gamesPlayed)[0];
  const cards = [
    { label: "League leader", icon: "trophy", value: leader.abbreviation, unit: "", note: `${leader.name}`, detail: `${leader.points} PTS`, team: leader, corner: "01" },
    { label: "Top offense", icon: "target", value: offense ? numeric(offense.goalsFor / offense.gamesPlayed, 2) : "—", unit: "GF / GP", note: offense?.name || "No games played yet", detail: "", team: offense, corner: "02" },
    { label: "Tightest defense", icon: "shield", value: defense ? numeric(defense.goalsAgainst / defense.gamesPlayed, 2) : "—", unit: "GA / GP", note: defense?.name || "No games played yet", detail: "", team: defense, corner: "03" },
    { label: "One league. Every team.", icon: "grid", value: teams.length, unit: "TEAMS", note: `${new Set(teams.map((team) => team.conference)).size} conferences`, detail: `${new Set(teams.map((team) => team.division)).size} divisions`, corner: "04" },
  ];
  $("#summary-cards").innerHTML = cards.map((card) => `<article class="stat-card ${card.team ? "" : "no-logo"}"><div class="stat-card-label">${icon(card.icon)}${card.label}</div><span class="card-corner">${card.corner}</span><div class="stat-card-value ${card.unit ? "" : "team-abbr"}">${escapeHTML(card.value)}<small>${card.unit}</small></div><div class="stat-card-note">${card.detail ? `<b>${escapeHTML(card.detail)}</b><span>·</span>` : ""}<span>${escapeHTML(card.note)}</span></div>${card.team ? image(card.team.logo, card.team.name, "stat-card-logo") : '<div class="mini-rink"><svg viewBox="0 0 100 55" aria-hidden="true"><rect x="1" y="1" width="98" height="53" rx="20"/><path d="M50 1v53M25 1v53M75 1v53"/><circle cx="50" cy="27" r="10"/></svg></div>'}</article>`).join("");
  $("#summary-cards").setAttribute("aria-busy", "false");
  $("#team-count").textContent = teams.length;
}

function filteredTeams() {
  const query = $("#standings-search").value.trim().toLowerCase();
  return (state.standings?.teams || []).filter((team) => {
    const matchesView = state.view === "division" ? team.division === state.division
      : (state.conference === "All" || team.conference === state.conference)
        && (state.view !== "wildcard" || team.divisionRank > 3);
    return matchesView && `${team.name} ${team.abbreviation}`.toLowerCase().includes(query);
  }).sort((a, b) => state.view === "wildcard" ? (a.wildcardRank || 999) - (b.wildcardRank || 999) : a.rank - b.rank);
}

function renderStandings() {
  const teams = filteredTeams();
  const visible = state.showAll ? teams : teams.slice(0, 8);
  const all = state.standings?.teams || [];
  const filters = state.view === "division" ? [...new Set(all.map(team => team.division))].sort() : state.view === "wildcard" ? [...new Set(all.map(team => team.conference))].sort() : ["All", ...new Set(all.map(team => team.conference))];
  $("#division-filter").innerHTML = filters.map(name => `<button data-filter="${escapeHTML(name)}" class="${(state.view === "division" ? state.division : state.conference) === name ? "active" : ""}" aria-pressed="${(state.view === "division" ? state.division : state.conference) === name}">${escapeHTML(name === "All" ? "All teams" : name)}</button>`).join("");
  $("#standings-heading").textContent = state.view === "division" ? `${all.find(team => team.division === state.division)?.conference || ""} · ${state.division}` : state.view === "wildcard" ? `${state.conference} · Wildcard` : `${state.conference === "All" ? "NHL" : state.conference} · League`;
  $("#standings-description").textContent = state.view === "division" ? "Top 3 division positions · current standings" : state.view === "wildcard" ? "Outside the division top 3 · NHL wildcard order" : "Official NHL standings & tiebreaker order";
  $("#team-count").textContent = teams.length;
  $("#standings-body").innerHTML = visible.length ? visible.map((team) => {
    const divisionPlace = team.divisionRank > 0 && team.divisionRank <= 3;
    const wildcardPlace = !divisionPlace && team.wildcardRank > 0 && team.wildcardRank <= 2;
    const rank = state.view === "division" ? team.divisionRank : state.view === "wildcard" ? team.wildcardRank : team.rank;
    return `<tr class="${divisionPlace ? "division-place" : wildcardPlace ? "wildcard-place" : ""}"><td><span class="rank-number">${rank || team.rank}</span></td><td><button class="team-cell" data-compare-team="${escapeHTML(team.abbreviation)}" title="Compare ${escapeHTML(team.name)}">${image(team.logo, "")}<span><strong>${escapeHTML(team.nickname || team.name)}</strong><small>${escapeHTML(team.abbreviation)} · ${divisionPlace ? "Division top 3" : wildcardPlace ? "Wildcard position" : escapeHTML(team.division)}</small></span></button></td><td>${team.gamesPlayed}</td><td>${team.wins}</td><td>${team.losses}</td><td>${team.otLosses}</td><td class="points">${team.points}</td><td class="${team.goalDifferential > 0 ? "positive" : team.goalDifferential < 0 ? "negative" : ""}">${signed(team.goalDifferential)}</td><td><span class="streak ${team.streak.startsWith("L") ? "loss" : ""}">${escapeHTML(team.streak || "—")}</span></td></tr>`;
  }).join("") : '<tr><td colspan="9" class="table-message">No teams match your search. Try a team name or abbreviation.</td></tr>';
  $("#standings-showing").textContent = `Showing ${visible.length} of ${teams.length} teams`;
  $("#show-all-teams").disabled = teams.length <= 8;
  $("#show-all-teams").innerHTML = `${state.showAll ? "Show fewer teams" : `View all ${teams.length} teams`}${icon("arrow")}`;
}

function renderDashboardCharts() {
  const teams = state.standings.teams;
  const top = teams.slice(0, 6);
  const scales = standardScales(true);
  scales.x.grid.display = true; scales.y.grid.display = false;
  chart("points-chart", "bar", { labels: top.map((team) => team.abbreviation), datasets: [{ data: top.map((team) => team.points), backgroundColor: top.map((team, index) => index === 0 ? colors.ice : "#3c6579"), borderRadius: 4, barThickness: 17 }] }, { indexAxis: "y", scales, layout: { padding: { right: 5 } }, plugins: { tooltip: { callbacks: { title: (items) => top[items[0].dataIndex].name, label: (item) => `${item.raw} points` } } } });
  const lead = top[0].points - (top[1]?.points ?? top[0].points);
  $("#race-insight").innerHTML = `${icon("info")}<span><strong>${escapeHTML(top[0].name)}</strong> ${lead ? `lead the league by ${lead} point${lead === 1 ? "" : "s"}.` : "sit atop the official NHL standings. Points are tied at the top."}</span>`;
  drawScatter("scatter-chart", teams);
  const hottest = [...teams].sort((a, b) => (b.streak.startsWith("W") ? Number(b.streak.slice(1)) : 0) - (a.streak.startsWith("W") ? Number(a.streak.slice(1)) : 0))[0];
  const differential = [...teams].sort((a, b) => b.goalDifferential - a.goalDifferential)[0];
  const scoring = [...teams].sort((a, b) => b.goalsFor - a.goalsFor)[0];
  const pulses = [
    { team: hottest, title: hottest.streak.startsWith("W") ? "Heating up" : "Current streak", description: `${hottest.name} · Last 10: ${hottest.lastTen}`, value: hottest.streak || "—" },
    { team: differential, title: "Making the difference", description: `${differential.name} lead in goal differential.`, value: signed(differential.goalDifferential) },
    { team: scoring, title: "Lighting the lamp", description: `${scoring.name} have the most goals scored.`, value: `${scoring.goalsFor} GF` },
  ];
  $("#league-pulse").innerHTML = pulses.map((pulse) => `<div class="pulse-item">${image(pulse.team.logo, "")}<div><h3>${pulse.title}</h3><p>${escapeHTML(pulse.description)}</p></div><span class="insight-value">${escapeHTML(pulse.value)}</span></div>`).join("");
}

function drawScatter(id, teams) {
  const played = teams.filter((team) => team.gamesPlayed > 0);
  chart(id, "scatter", { datasets: [{ data: played.map((team) => ({ x: team.goalsAgainst / team.gamesPlayed, y: team.goalsFor / team.gamesPlayed, team })), backgroundColor: "#79dced99", borderColor: colors.ice, borderWidth: 1, pointRadius: 4, pointHoverRadius: 7 }] }, {
    scales: {
      x: { title: { display: true, text: "GOALS AGAINST / GAME →", color: colors.muted, font: { size: 8 }, padding: 9 }, grid: { color: "#24314677" }, border: { display: false }, ticks: { font: { size: 8 }, maxTicksLimit: 6 } },
      y: { title: { display: true, text: "GOALS FOR / GAME →", color: colors.muted, font: { size: 8 }, padding: 5 }, grid: { color: "#24314677" }, border: { display: false }, ticks: { font: { size: 8 }, maxTicksLimit: 5 } },
    }, plugins: { tooltip: { callbacks: { title: (items) => items[0].raw.team.name, label: (item) => `${item.raw.y.toFixed(2)} GF/GP · ${item.raw.x.toFixed(2)} GA/GP` } } },
  });
}

async function loadStandings(refresh = false) {
  const button = $("#refresh-button");
  button.disabled = true; button.classList.add("spinning");
  showError("#dashboard-error", "");
  try {
    state.standings = await api("/api/standings");
    const { season, dataDate, teams } = state.standings;
    if (!teams.some(team => team.division === state.division)) state.division = teams[0].division;
    $$(".season-label").forEach((element) => { element.textContent = season.label; });
    $("#updated-label").textContent = `NHL snapshot: ${dataDate || "current"} · 60-second cache`;
    $("#connection-status").innerHTML = '<span class="status-dot"></span>NHL DATA';
    $("#export-standings").disabled = false;
    renderSummary(); renderStandings(); renderDashboardCharts();
    if (!state.selected["team-first"]) setSelected("team-first", teams.find((team) => team.abbreviation === "TOR") || teams[0]);
    if (!state.selected["team-second"]) setSelected("team-second", teams.find((team) => team.abbreviation === "EDM") || teams[1]);
    await runComparison("teams");
    if (state.page === "players" && !state.defaultPlayersStarted) loadDefaultPlayers();
    if (refresh && state.selected["player-first"] && state.selected["player-second"]) await runComparison("players");
    if (refresh && state.page === "search") loadPlayerBrowser();
    if (refresh && state.page === "profile" && browserState.profile) loadPlayerProfile(browserState.profile.id);
    if (state.page === "visualizations") renderVisualizations();
    if (refresh) toast("Data refreshed. NHL responses are cached for up to 60 seconds.");
  } catch (error) {
    showError("#dashboard-error", error.message, true);
    $("#connection-status").innerHTML = `${icon("info")}DATA UNAVAILABLE`;
    if (!state.standings) {
      $("#summary-cards").innerHTML = '<div class="stat-card no-logo" style="grid-column:1/-1"><p class="muted">Live statistics are unavailable. Use “Try again” to reconnect to the NHL.</p></div>';
      $("#summary-cards").setAttribute("aria-busy", "false");
      $("#standings-body").innerHTML = '<tr><td colspan="9" class="table-message">Standings could not load. Please retry above.</td></tr>';
      $("#race-insight").innerHTML = `${icon("info")}<span>Waiting for NHL standings. Retry to load the points race.</span>`;
      $("#league-pulse").innerHTML = '<p class="muted">League insights will appear when NHL data is available.</p>';
      $("#team-results").innerHTML = emptyState("NHL data is taking a timeout.", "Return to the dashboard and retry loading the standings.", "dashboard", "Back to dashboard");
    } else {
      $("#updated-label").textContent += " · Refresh failed; showing previous snapshot";
    }
    if (state.page === "visualizations") renderVisualizations();
    toast(error.message);
  } finally {
    button.disabled = false; button.classList.remove("spinning");
  }
}

function setSelected(id, item) {
  state.selected[id] = item;
  $("#" + id).value = item.name;
  $("#" + id).setAttribute("aria-expanded", "false");
  $("#" + id + "-results").hidden = true;
  updateCompareButton(id.startsWith("team") ? "teams" : "players");
}

function updateCompareButton(type) {
  const prefix = type === "teams" ? "team" : "player";
  $("#compare-" + type).disabled = !(state.selected[`${prefix}-first`] && state.selected[`${prefix}-second`]);
}

function invalidateComparison(type) {
  state.sequences[type]++;
  state.comparisons[type] = null;
  const prefix = type === "teams" ? "team" : "player";
  $("#compare-" + type).innerHTML = `Compare ${type}${icon("arrow")}`;
  showError(`#${prefix}-error`, "");
  destroyChart(`${prefix}-bar`); destroyChart(`${prefix}-radar`);
  $(`#${prefix}-results`).innerHTML = emptyState("Ready for a fresh matchup.", `Choose two ${type} and press Compare to see their current-season statistics.`);
}

function setupSelector(id, type) {
  const input = $("#" + id);
  const list = $("#" + id + "-results");
  let sequence = 0, timer, activeIndex = -1;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); activeIndex = -1; };
  const show = (content) => { list.innerHTML = content; list.hidden = false; input.setAttribute("aria-expanded", "true"); activeIndex = -1; };
  const options = (items) => {
    if (!items.length) { show('<div class="search-message" role="status">No matches found. Try a different name.</div>'); return; }
    show(items.map((item, index) => `<button type="button" role="option" aria-selected="false" class="result-option" id="${id}-option-${index}" tabindex="-1">${type === "teams" ? image(item.logo, "") : icon("players")}<span><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(type === "teams" ? `${item.conference} · ${item.division}` : `${item.team} · ${item.position || "Skater"}${item.active ? "" : " · Inactive"}`)}</small></span><span class="option-code">${escapeHTML(type === "teams" ? item.abbreviation : "NHL")}</span></button>`).join(""));
    [...list.querySelectorAll("button")].forEach((button, index) => button.addEventListener("click", () => {
      sequence++; clearTimeout(timer); invalidateComparison(type); setSelected(id, items[index]); input.focus(); close();
    }));
  };
  async function search() {
    const current = ++sequence;
    if (type === "teams") {
      const query = (state.selected[id] ? "" : input.value).trim().toLowerCase();
      options((state.standings?.teams || []).filter((team) => `${team.name} ${team.abbreviation}`.toLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name)));
      return;
    }
    const query = input.value.trim();
    if (query.length < 2) { show('<div class="search-message" role="status">Type at least two letters to search the NHL.</div>'); return; }
    show('<div class="search-message" role="status">Searching the NHL…</div>');
    try {
      const data = await api(`/api/players/search?q=${encodeURIComponent(query)}`);
      if (current === sequence && document.activeElement === input) options(data.players);
    } catch (error) {
      if (current === sequence) show(`<div class="search-message" role="status">${escapeHTML(error.message)}</div>`);
    }
  }
  input.addEventListener("input", () => {
    sequence++; clearTimeout(timer); state.selected[id] = null;
    invalidateComparison(type); updateCompareButton(type); close();
    timer = setTimeout(search, type === "teams" ? 0 : 300);
  });
  input.addEventListener("focus", search);
  input.addEventListener("keydown", (event) => {
    const buttons = [...list.querySelectorAll("button")];
    if (event.key === "Escape") { close(); return; }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && buttons.length && !list.hidden) {
      event.preventDefault();
      activeIndex = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons.forEach((button, index) => button.setAttribute("aria-selected", String(index === activeIndex)));
      input.setAttribute("aria-activedescendant", buttons[activeIndex].id);
      buttons[activeIndex].scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter" && activeIndex >= 0 && !list.hidden) { event.preventDefault(); buttons[activeIndex]?.click(); }
  });
  document.addEventListener("click", (event) => { if (!input.closest(".selector-field").contains(event.target)) close(); });
  input.addEventListener("blur", () => setTimeout(() => { if (!input.closest(".selector-field").contains(document.activeElement)) close(); }, 160));
}

async function runComparison(type) {
  const prefix = type === "teams" ? "team" : "player";
  const first = state.selected[`${prefix}-first`], second = state.selected[`${prefix}-second`];
  if (!first || !second) return;
  const firstKey = first.abbreviation || first.id, secondKey = second.abbreviation || second.id;
  const current = ++state.sequences[type];
  showError(`#${prefix}-error`, "");
  const button = $("#compare-" + type);
  button.disabled = true; button.textContent = "Loading NHL data…";
  destroyChart(`${prefix}-bar`); destroyChart(`${prefix}-radar`);
  $(`#${prefix}-results`).innerHTML = `<div class="panel loading-panel" role="status">${icon("refresh")}Retrieving current-season statistics…</div>`;
  try {
    const data = await api(`/api/compare/${type}?first=${encodeURIComponent(firstKey)}&second=${encodeURIComponent(secondKey)}`);
    if (current !== state.sequences[type]) return;
    state.comparisons[type] = data;
    renderComparison(type, data);
    if (state.page === "visualizations" && state.vizMode === type) renderVisualizations();
  } catch (error) {
    if (current !== state.sequences[type]) return;
    state.comparisons[type] = null;
    showError(`#${prefix}-error`, error.message);
    $(`#${prefix}-results`).innerHTML = emptyState("This matchup needs another look.", "Check your selections above, or try again if the NHL service is unavailable.");
  } finally {
    if (current === state.sequences[type]) {
      button.innerHTML = `Compare ${type}${icon("arrow")}`;
      updateCompareButton(type);
    }
  }
}

function comparisonMetrics(type) {
  return type === "teams" ? [
    { key: "wins", label: "Wins" }, { key: "losses", label: "Losses", lower: true },
    { key: "points", label: "Points" }, { key: "goalsFor", label: "Goals for" },
    { key: "goalsAgainst", label: "Goals against", lower: true }, { key: "goalDifferential", label: "Goal differential", signed: true },
  ] : [{ key: "goals", label: "Goals" }, { key: "assists", label: "Assists" }, { key: "points", label: "Points" }, { key: "gamesPlayed", label: "Games played", neutral: true }];
}

function contenderHTML(item, type, second) {
  const isTeam = type === "teams";
  return `<div class="contender ${second ? "second" : ""}">${image(isTeam ? item.logo : item.headshot, item.name, isTeam ? "" : "headshot")}<div><div class="team-meta">${escapeHTML(isTeam ? `${item.conference.toUpperCase()} CONFERENCE` : `${item.team} · ${item.position}${item.number ? ` · #${item.number}` : ""}`)}</div><h2>${escapeHTML(item.name)}</h2><p>${isTeam ? `${item.wins}–${item.losses}–${item.otLosses} record · ${item.gamesPlayed} games` : "Current NHL regular season"}</p></div></div>`;
}

function renderComparison(type, data) {
  const prefix = type === "teams" ? "team" : "player";
  const firstStats = type === "teams" ? data.first : data.first.stats;
  const secondStats = type === "teams" ? data.second : data.second.stats;
  const rows = comparisonMetrics(type).map((metric) => {
    const a = firstStats[metric.key], b = secondStats[metric.key], max = Math.max(Math.abs(a), Math.abs(b), 1);
    const winnerA = !metric.neutral && a !== b && (metric.lower ? a < b : a > b);
    const winnerB = !metric.neutral && a !== b && !winnerA;
    return `<div class="comparison-row"><div class="comparison-stat ${winnerA ? "winner" : ""}"><span class="compare-number">${metric.signed ? signed(a) : a}</span><div class="metric-bar"><span style="width:${Math.abs(a) / max * 100}%"></span></div></div><span class="metric-label">${metric.label}</span><div class="comparison-stat second ${winnerB ? "winner" : ""}"><span class="compare-number">${metric.signed ? signed(b) : b}</span><div class="metric-bar"><span style="width:${Math.abs(b) / max * 100}%"></span></div></div></div>`;
  }).join("");
  $(`#${prefix}-results`).innerHTML = `<article class="panel matchup-panel"><div class="matchup-heading">${contenderHTML(data.first, type, false)}<div class="versus">VS</div>${contenderHTML(data.second, type, true)}</div><div class="comparison-label">${escapeHTML(data.season.label)} REGULAR SEASON · TOTALS</div><div class="comparison-rows">${rows}</div><div class="matchup-footer">${icon("info")}Color highlights the better total. ${type === "teams" ? "Fewer losses and goals against are better; games played may differ. Negative goal differentials use absolute bar lengths." : "Games played provide context and aren't ranked."}</div></article><div class="comparison-chart-grid"><article class="panel"><div class="panel-heading"><div><h2>${type === "teams" ? "The matchup, visualized" : "Production breakdown"}</h2><p>Real numbers. A different perspective.</p></div><span class="chart-tag">TOTALS</span></div><div class="compare-legend"><span><span class="legend-dot cyan"></span>${escapeHTML(data.first.name)}</span><span><span class="legend-dot orange"></span>${escapeHTML(data.second.name)}</span></div><div class="chart-container comparison-chart"><canvas id="${prefix}-bar" role="img" aria-label="Grouped bar chart comparing current-season statistics"></canvas></div></article><article class="panel"><div class="panel-heading"><div><h2>${type === "teams" ? "Win breakdown" : "Scoring profile"}</h2><p>${type === "teams" ? "Share of each team's games played." : "Goals, assists and points at a glance."}</p></div></div><div class="chart-container comparison-chart"><canvas id="${prefix}-radar" role="img" aria-label="${type === "teams" ? "Win, loss and overtime loss percentages" : "Radar comparison of goals, assists and points"}"></canvas></div></article></div>`;
  drawComparisonBar(`${prefix}-bar`, type, data);
  drawProfile(`${prefix}-radar`, type, data);
}

function drawComparisonBar(id, type, data) {
  const metrics = comparisonMetrics(type);
  const values = (item) => metrics.map((metric) => (type === "teams" ? item : item.stats)[metric.key]);
  const scales = standardScales(); scales.x.grid.display = false;
  chart(id, "bar", { labels: metrics.map((metric) => metric.label), datasets: [
    { label: data.first.name, data: values(data.first), backgroundColor: colors.ice, borderRadius: 4, maxBarThickness: 30 },
    { label: data.second.name, data: values(data.second), backgroundColor: colors.orange, borderRadius: 4, maxBarThickness: 30 },
  ] }, { scales, plugins: { tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${item.raw}` } } } });
}

function drawProfile(id, type, data) {
  if (type === "teams") {
    const values = (key) => [data.first, data.second].map((team) => team.gamesPlayed ? +(team[key] / team.gamesPlayed * 100).toFixed(1) : 0);
    chart(id, "bar", { labels: [data.first.abbreviation, data.second.abbreviation], datasets: [
      { label: "Wins", data: values("wins"), backgroundColor: colors.ice, borderRadius: 3 },
      { label: "Losses", data: values("losses"), backgroundColor: "#426077" },
      { label: "OT losses", data: values("otLosses"), backgroundColor: colors.orange, borderRadius: 3 },
    ] }, { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, min: 0, max: 100, ticks: { callback: (value) => `${value}%`, font: { size: 9 } }, grid: { color: "#24314688" } } }, plugins: { legend: { display: true, position: "bottom", labels: { usePointStyle: true, boxWidth: 6, boxHeight: 6, padding: 15, font: { size: 9 } } }, tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${item.raw}%` } } } });
  } else {
    chart(id, "radar", { labels: ["Goals", "Assists", "Points"], datasets: [data.first, data.second].map((player, index) => ({ label: player.name, data: [player.stats.goals, player.stats.assists, player.stats.points], borderColor: index ? colors.orange : colors.ice, backgroundColor: index ? "#eac18b16" : "#79dced1c", borderWidth: 2, pointRadius: 3 })) }, { scales: { r: { beginAtZero: true, ticks: { display: false }, grid: { color: "#34445c" }, angleLines: { color: "#34445c" }, pointLabels: { color: colors.muted, font: { size: 10 } } } } });
  }
}

async function loadDefaultPlayers() {
  state.defaultPlayersStarted = true;
  const initialSequence = state.sequences.players;
  try {
    // Names are starting selections only. IDs and statistics are always fetched.
    const names = ["Connor McDavid", "Auston Matthews"];
    const results = await Promise.all(names.map((name) => api(`/api/players/search?q=${encodeURIComponent(name)}`)));
    if (initialSequence !== state.sequences.players || $("#player-first").value || $("#player-second").value) return;
    const players = results.map((result, index) => result.players.find((player) => player.name.toLowerCase() === names[index].toLowerCase()));
    if (players.every(Boolean)) { setSelected("player-first", players[0]); setSelected("player-second", players[1]); await runComparison("players"); }
  } catch (error) {
    if (initialSequence === state.sequences.players) showError("#player-error", error.message);
  }
}

function swap(type) {
  const prefix = type === "teams" ? "team" : "player";
  const first = state.selected[`${prefix}-first`], second = state.selected[`${prefix}-second`];
  if (!first || !second) { toast(`Select two ${type} first.`); return; }
  setSelected(`${prefix}-first`, second); setSelected(`${prefix}-second`, first); runComparison(type);
}

function renderVisualizations() {
  Object.keys(state.charts).filter((id) => id.startsWith("viz-")).forEach(destroyChart);
  const mode = state.vizMode;
  if (mode !== "league") {
    const data = state.comparisons[mode];
    $("#download-chart").disabled = !data;
    if (!data) { $("#viz-content").innerHTML = emptyState(`Your ${mode === "teams" ? "team" : "player"} matchup belongs here.`, `Complete a ${mode === "teams" ? "team" : "player"} comparison to explore its live statistics as interactive charts.`, mode, `Compare ${mode}`); return; }
    $("#viz-content").innerHTML = `<article class="panel viz-panel"><div class="panel-heading"><div><h2>${escapeHTML(data.first.name)} vs. ${escapeHTML(data.second.name)}</h2><p>${escapeHTML(data.season.label)} NHL regular season</p></div><a href="#${mode}" class="text-button">Change matchup${icon("arrow")}</a></div><div class="compare-legend"><span><span class="legend-dot cyan"></span>${escapeHTML(data.first.name)}</span><span><span class="legend-dot orange"></span>${escapeHTML(data.second.name)}</span></div><div class="chart-container large-chart"><canvas id="viz-main" role="img" aria-label="Comparison chart of the selected matchup"></canvas></div><div class="viz-caption">Hover or tap a bar for exact values. All statistics are current regular-season totals from the NHL.</div></article>`;
    drawComparisonBar("viz-main", mode, data); return;
  }
  if (!state.standings) {
    $("#download-chart").disabled = true;
    $("#viz-content").innerHTML = emptyState("The league view is warming up.", "Load current NHL standings from the dashboard to see league visualizations.", "dashboard", "Go to dashboard"); return;
  }
  $("#download-chart").disabled = false;
  const teams = state.standings.teams;
  $("#viz-content").innerHTML = '<article class="panel viz-panel"><div class="panel-heading"><div><h2>The league, ranked</h2><p>Points for every team, in official NHL standings order.</p></div><span class="chart-tag">ALL TEAMS</span></div><div class="chart-container large-chart"><canvas id="viz-main" role="img" aria-label="Bar chart of points for all NHL teams"></canvas></div><div class="viz-caption">Hover or tap for exact totals. Official NHL tiebreakers determine order when teams have the same points.</div></article><div class="viz-grid"><article class="panel"><div class="panel-heading"><div><h2>Offense vs. defense</h2><p>Per-game averages give context when games played differ.</p></div></div><div class="chart-container large-chart"><canvas id="viz-scatter" role="img" aria-label="All teams’ goals for and goals against per game"></canvas></div></article><article class="panel"><div class="panel-heading"><div><h2>The conference split</h2><p>Total points earned by teams in each conference.</p></div></div><div class="chart-container large-chart"><canvas id="viz-conference" role="img" aria-label="Doughnut chart of total points by conference"></canvas></div></article></div>';
  const mobile = matchMedia("(max-width: 550px)").matches;
  const scales = standardScales(mobile); scales.x.grid.display = mobile; scales.y.grid.display = !mobile;
  if (mobile) { scales.y.ticks.autoSkip = false; $("#viz-main").parentElement.style.height = "850px"; }
  else { scales.x.ticks.maxRotation = 65; scales.x.ticks.minRotation = 65; scales.x.ticks.autoSkip = false; }
  chart("viz-main", "bar", { labels: teams.map((team) => team.abbreviation), datasets: [{ data: teams.map((team) => team.points), backgroundColor: teams.map((team) => team.conference === "Eastern" ? colors.ice : "#477b95"), borderRadius: 3, maxBarThickness: mobile ? 13 : 24 }] }, { indexAxis: mobile ? "y" : "x", scales, plugins: { tooltip: { callbacks: { title: (items) => teams[items[0].dataIndex].name, label: (item) => `${item.raw} points` } } } });
  drawScatter("viz-scatter", teams);
  const conferences = [...new Set(teams.map((team) => team.conference))];
  chart("viz-conference", "doughnut", { labels: conferences, datasets: [{ data: conferences.map((name) => teams.filter((team) => team.conference === name).reduce((total, team) => total + team.points, 0)), backgroundColor: [colors.ice, "#477b95"], borderColor: "#131e2f", borderWidth: 6, hoverOffset: 7 }] }, { cutout: "77%", plugins: { legend: { display: true, position: "bottom", labels: { usePointStyle: true, boxWidth: 7, boxHeight: 7, padding: 20, font: { size: 10 } } }, tooltip: { callbacks: { label: (item) => `${item.label}: ${item.raw} points` } } } });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportStandings() {
  if (!state.standings) return;
  const fields = ["rank", "name", "abbreviation", "conference", "division", "gamesPlayed", "wins", "losses", "otLosses", "points", "goalsFor", "goalsAgainst", "goalDifferential"];
  const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [fields.join(","), ...filteredTeams().map((team) => fields.map((field) => quote(team[field])).join(","))].join("\r\n");
  downloadBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }), `nhl-standings-${state.standings.dataDate}.csv`);
  toast("Standings exported. Conference and search filters are included.");
}

// Bind once; rendering only replaces dynamic content inside the panels.
window.addEventListener("hashchange", navigate);
$("#today").textContent = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Toronto" }).format(new Date());
$("#menu-button").addEventListener("click", () => setSidebar(!$("#sidebar").classList.contains("open")));
$("#sidebar-backdrop").addEventListener("click", () => setSidebar(false));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") setSidebar(false); });
$("#refresh-button").addEventListener("click", () => loadStandings(true));
document.addEventListener("click", (event) => {
  if (event.target.closest("#retry-data")) loadStandings(true);
  const button = event.target.closest("[data-compare-team]");
  if (button) {
    const team = state.standings.teams.find((item) => item.abbreviation === button.dataset.compareTeam);
    setSelected("team-first", team);
    if (state.selected["team-second"]?.abbreviation === team.abbreviation) setSelected("team-second", state.standings.teams.find((item) => item.abbreviation !== team.abbreviation));
    runComparison("teams"); location.hash = "teams";
  }
});
$("#standings-search").addEventListener("input", renderStandings);
$("#show-all-teams").addEventListener("click", () => { state.showAll = !state.showAll; renderStandings(); });
$("#export-standings").addEventListener("click", exportStandings);
["first", "second"].forEach((side) => { setupSelector(`team-${side}`, "teams"); setupSelector(`player-${side}`, "players"); });
["teams", "players"].forEach((type) => {
  $("#compare-" + type).addEventListener("click", () => runComparison(type));
  $("#swap-" + type).addEventListener("click", () => swap(type));
});
$("#viz-mode").addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]"); if (!button) return;
  state.vizMode = button.dataset.mode;
  $$("#viz-mode button").forEach((item) => { item.classList.toggle("active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
  renderVisualizations();
});
$("#download-chart").addEventListener("click", () => {
  const instance = state.charts["viz-main"];
  if (!instance) { toast("Load a chart first, then try saving again."); return; }
  instance.canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `iceiq-${state.vizMode}-${state.standings?.dataDate || "chart"}.png`); });
});
setupStitchInteractions(); setupChartDefaults(); navigate(); loadStandings();
