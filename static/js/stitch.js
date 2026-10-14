/* Stitch presentation and player exploration, using the existing Flask API. */
"use strict";

const browserState = { loaded: false, sequence: 0, profileSequence: 0, players: [], position: "All", savedOnly: false, profile: null };

function readPreferences(key) {
  try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function writePreferences(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { toast("Your browser couldn't save this preference. You can still explore NHL data."); }
}
function savedPlayerIds() { return readPreferences("puckpulse.saved").filter(id => Number.isInteger(id) && id > 0 && id <= 99999999).slice(0, 24); }
function isPlayerSaved(id) { return savedPlayerIds().includes(id); }
function toggleSavedPlayer(id) {
  const saved = savedPlayerIds(), found = saved.includes(id);
  if (!found && saved.length >= 24) { toast("You can save up to 24 players. Remove a saved player to add another."); return; }
  writePreferences("puckpulse.saved", found ? saved.filter(item => item !== id) : [...saved, id]);
  updateSaveButton();
  toast(found ? "Player removed from your saved list." : "Player saved on this browser.");
}
function updateSaveButton() {
  const button = $("#save-profile"), player = browserState.profile;
  if (button && player) {
    button.setAttribute("aria-pressed", String(isPlayerSaved(player.id)));
    button.innerHTML = `${icon("players")}${isPlayerSaved(player.id) ? "Saved player" : "Save player"}`;
  }
}
function renderRecentSearches() {
  const recent = readPreferences("puckpulse.recent").filter(value => typeof value === "string" && value.length <= 80).slice(0, 4);
  $("#recent-searches").hidden = !recent.length;
  $("#recent-search-list").innerHTML = recent.map(name => `<button data-recent="${escapeHTML(name)}">${escapeHTML(name)} ↗</button>`).join("");
}
function rememberSearch(query) {
  if (query.length < 2) return;
  writePreferences("puckpulse.recent", [query, ...readPreferences("puckpulse.recent").filter(value => value !== query)].slice(0, 4));
  renderRecentSearches();
}
function playerCard(player) {
  const stats = player.stats;
  const metrics = [["GP", stats?.gamesPlayed], ["G", stats?.goals], ["A", stats?.assists], ["PTS", stats?.points]];
  return `<article class="player-card"><a class="player-card-main" href="#player/${player.id}" aria-label="View ${escapeHTML(player.name)} profile">${image(player.headshot, "")}<span><strong>${escapeHTML(player.name)}</strong><small>${player.number ? `#${escapeHTML(player.number)} · ` : ""}${escapeHTML(player.position || "NHL")} · ${escapeHTML(player.teamName || player.team)}</small></span>${icon("arrow")}</a><div class="player-mini-stats">${metrics.map(([label, value]) => `<div><small>${label}</small><strong>${numeric(value)}</strong></div>`).join("")}</div>${!player.available ? `<p class="unavailable">${escapeHTML(player.unavailableReason || "Season statistics are unavailable. Open the profile to retry.")}</p>` : ""}</article>`;
}
function renderPlayerBrowser() {
  const players = browserState.players.filter(player => browserState.position === "All" || (browserState.position === "W" ? ["L", "R", "LW", "RW"].includes(player.position) : player.position === browserState.position));
  $("#player-browser-results").innerHTML = players.length ? players.map(playerCard).join("") : emptyState("No players found", browserState.savedOnly ? "Save a player from their profile, or change the position filter." : "Try another name or choose All players. Position filters apply to the returned matches.");
}
async function loadPlayerBrowser() {
  const sequence = ++browserState.sequence;
  const query = $("#player-browser-query").value.trim();
  browserState.loaded = true;
  showError("#player-browser-status", "");
  $("#player-browser-results").setAttribute("aria-busy", "true");
  $("#player-browser-results").innerHTML = '<div class="panel loading-panel" role="status">Retrieving NHL player statistics…</div>';
  $("#player-browser-heading").textContent = browserState.savedOnly ? "Saved Players" : query ? "Search Results" : "NHL Points Leaders";
  $("#player-browser-note").textContent = browserState.savedOnly ? "Saved on this browser. Statistics are retrieved from the NHL." : query ? "NHL name matches · filters apply to these results." : "Current-season skater totals, supplied by the NHL.";
  try {
    let players;
    if (!browserState.savedOnly && !query) {
      players = (await api("/api/players/leaders")).players;
    } else {
      if (!browserState.savedOnly && query.length < 2) {
        browserState.players = [];
        $("#player-browser-results").innerHTML = emptyState("Keep typing", "Enter at least two letters to search NHL players.");
        return;
      }
      const matches = browserState.savedOnly ? savedPlayerIds().map(id => ({ id, name: "Saved player", team: "NHL" })) : (await api(`/api/players/search?q=${encodeURIComponent(query)}`)).players;
      if (sequence !== browserState.sequence) return;
      const profiles = await Promise.allSettled(matches.map(player => api(`/api/players/${player.id}`)));
      players = profiles.map((result, index) => result.status === "fulfilled" ? result.value : { ...matches[index], available: false, unavailableReason: result.reason.message });
      if (profiles.some(result => result.status === "rejected")) showError("#player-browser-status", "Some player profiles could not load. Open a profile to retry.");
    }
    if (sequence !== browserState.sequence) return;
    browserState.players = players;
    renderPlayerBrowser();
  } catch (error) {
    if (sequence !== browserState.sequence) return;
    browserState.players = [];
    showError("#player-browser-status", error.message);
    $("#player-browser-results").innerHTML = '<div class="panel empty-state"><h2>Player data is unavailable</h2><p>Try reconnecting to the NHL data service.</p><button class="primary-button" id="retry-players">Try again</button></div>';
  } finally {
    if (sequence === browserState.sequence) $("#player-browser-results").setAttribute("aria-busy", "false");
  }
}
function profileStats(player) {
  if (!player.available) return `<p class="profile-empty">${escapeHTML(player.unavailableReason)}</p>`;
  const stats = player.stats, extra = player.extraStats;
  const metrics = [
    ["Points", stats.points, `${numeric(stats.gamesPlayed ? stats.points / stats.gamesPlayed : null, 2)} points per game`],
    ["Goals", stats.goals, `${numeric(stats.gamesPlayed ? stats.goals / stats.gamesPlayed : null, 2)} goals per game`],
    ["Assists", stats.assists, `${numeric(stats.gamesPlayed ? stats.assists / stats.gamesPlayed : null, 2)} assists per game`],
    ["Plus / Minus", extra.plusMinus, `${numeric(stats.gamesPlayed)} games played`],
  ];
  return `<div class="profile-stats">${metrics.map(([label, value, detail]) => `<div class="profile-stat"><span>${label}</span><strong>${label === "Plus / Minus" && Number.isFinite(value) ? signed(value) : numeric(value)}</strong><small>${detail}</small></div>`).join("")}</div><div class="profile-extras">${[["SHOTS", numeric(extra.shots)], ["PIM", numeric(extra.pim)], ["PP POINTS", numeric(extra.powerPlayPoints)], ["SHOOTING %", Number.isFinite(extra.shootingPctg) ? numeric(extra.shootingPctg * 100, 1) + "%" : "—"]].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("")}</div>`;
}
function profileGameLog(player) {
  if (!player.recentGames.length) return '<p class="profile-empty">No recent NHL regular-season games have been published for this season.</p>';
  return `<div class="table-scroll"><table class="game-log"><caption class="sr-only">Recent games in the current NHL regular season</caption><thead><tr>${["DATE", "OPP", "G", "A", "PTS", "+/−", "TOI"].map(label => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>${player.recentGames.map(game => `<tr><td>${escapeHTML(new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(game.gameDate + "T12:00:00Z")))}</td><td>${game.homeRoadFlag === "R" ? "@" : "vs"} ${escapeHTML(game.opponentAbbrev)}</td><td>${numeric(game.goals)}</td><td>${numeric(game.assists)}</td><td class="points">${numeric(game.points)}</td><td>${Number.isFinite(game.plusMinus) ? signed(game.plusMinus) : "—"}</td><td>${escapeHTML(game.toi || "—")}</td></tr>`).join("")}</tbody></table></div>`;
}
function renderPlayerProfile(player) {
  const draft = player.draft;
  $("#player-profile-content").innerHTML = `<div class="profile-hero">${image(player.headshot, player.name, "profile-portrait")}<div class="profile-identity"><span class="profile-tag">${escapeHTML(player.position)} · ${player.active ? "ACTIVE NHL PLAYER" : "NHL PLAYER"}</span><h1 id="profile-title">${escapeHTML(player.name)}</h1><p>${escapeHTML(player.teamName || player.team)}${player.number ? ` · #${escapeHTML(player.number)}` : ""}</p><p>${player.heightCm ? `${escapeHTML(player.heightCm)} cm · ` : ""}${player.weightKg ? `${escapeHTML(player.weightKg)} kg · ` : ""}${player.shootsCatches ? `${player.position === "G" ? "Catches" : "Shoots"} ${escapeHTML(player.shootsCatches)}` : ""}</p></div>${image(player.teamLogo, "", "profile-team-logo")}</div><div class="profile-draft"><span>${draft ? `<strong>DRAFT PROFILE</strong><br>${escapeHTML(draft.year)} · Round ${escapeHTML(draft.round)} · #${escapeHTML(draft.overallPick)} overall (${escapeHTML(draft.teamAbbrev)})` : "Draft details unavailable"}</span><span>${escapeHTML(player.season.label)}<br>NHL REGULAR SEASON</span></div><div class="profile-grid"><section class="profile-section"><h2>Season Performance</h2>${profileStats(player)}</section><section class="profile-section"><h2>Recent Game Log</h2>${profileGameLog(player)}</section></div><section class="profile-section profile-awards"><h2>Career Accolades</h2>${player.awards.length ? `<div class="award-grid">${player.awards.map(award => `<article class="award-card">${icon("trophy")}<strong>${escapeHTML(award.name)}</strong><span>${award.seasons.length}× winner</span><small>${award.seasons.map(escapeHTML).join(" · ")}</small></article>`).join("")}</div>` : '<p class="profile-empty">No career awards are listed in this NHL profile.</p>'}</section><div class="profile-actions"><button class="primary-button" id="save-profile" aria-pressed="false">Save player</button><button class="secondary-button" id="compare-profile">${icon("compare")}Compare stats</button></div>`;
  updateSaveButton();
  document.title = `${player.name} — PuckPulse`;
}
async function loadPlayerProfile(id) {
  const sequence = ++browserState.profileSequence;
  browserState.profile = null;
  $("#player-profile-content").innerHTML = '<div class="panel loading-panel" role="status"><h1 id="profile-title">Loading player profile…</h1></div>';
  try {
    const player = await api(`/api/players/${id}`);
    if (sequence !== browserState.profileSequence) return;
    browserState.profile = player;
    renderPlayerProfile(player);
  } catch (error) {
    if (sequence !== browserState.profileSequence) return;
    $("#player-profile-content").innerHTML = `<div class="panel empty-state profile-error"><h1 id="profile-title">Profile unavailable</h1><p>${escapeHTML(error.message)}</p><button class="primary-button" id="retry-profile" data-id="${id}">Try again</button></div>`;
  }
}
function setupStitchInteractions() {
  renderRecentSearches();
  $("#standings-view").addEventListener("click", event => {
    const button = event.target.closest("[data-view]"); if (!button) return;
    state.view = button.dataset.view; state.showAll = false;
    if (state.view === "wildcard" && state.conference === "All") state.conference = "Eastern";
    $$("#standings-view button").forEach(item => { item.classList.toggle("active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
    renderStandings();
  });
  $("#division-filter").addEventListener("click", event => {
    const button = event.target.closest("[data-filter]"); if (!button) return;
    if (state.view === "division") state.division = button.dataset.filter; else state.conference = button.dataset.filter;
    state.showAll = false; renderStandings();
  });
  let searchTimer;
  $("#player-browser-query").addEventListener("input", () => {
    clearTimeout(searchTimer); browserState.sequence++;
    searchTimer = setTimeout(loadPlayerBrowser, 350);
  });
  $("#player-browser-form").addEventListener("submit", event => {
    event.preventDefault(); clearTimeout(searchTimer);
    rememberSearch($("#player-browser-query").value.trim()); loadPlayerBrowser();
  });
  $("#position-filter").addEventListener("click", event => {
    const button = event.target.closest("[data-position]"); if (!button) return;
    browserState.position = button.dataset.position;
    $$("#position-filter button").forEach(item => { item.classList.toggle("active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
    renderPlayerBrowser();
  });
  $("#favorites-filter").addEventListener("click", event => {
    browserState.savedOnly = !browserState.savedOnly;
    event.currentTarget.setAttribute("aria-pressed", String(browserState.savedOnly));
    event.currentTarget.textContent = browserState.savedOnly ? "Show all players" : "Saved players";
    loadPlayerBrowser();
  });
  $("#clear-recent").addEventListener("click", () => { writePreferences("puckpulse.recent", []); renderRecentSearches(); });
  $("#sidebar-close").addEventListener("click", () => { setSidebar(false); $("#menu-button").focus(); });
  matchMedia("(max-width: 800px)").addEventListener("change", () => setSidebar(false));
  document.addEventListener("keydown", event => {
    if (event.key !== "Tab" || !$("#sidebar").classList.contains("open") || !matchMedia("(max-width: 800px)").matches) return;
    const elements = [...$("#sidebar").querySelectorAll("a[href],button")], first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.addEventListener("click", event => {
    const recent = event.target.closest("[data-recent]");
    if (recent) { $("#player-browser-query").value = recent.dataset.recent; loadPlayerBrowser(); }
    if (event.target.closest("#retry-players")) loadPlayerBrowser();
    const retry = event.target.closest("#retry-profile"); if (retry) loadPlayerProfile(Number(retry.dataset.id));
    if (event.target.closest("#save-profile") && browserState.profile) toggleSavedPlayer(browserState.profile.id);
    if (event.target.closest("#compare-profile") && browserState.profile) {
      const player = browserState.profile;
      invalidateComparison("players"); setSelected("player-first", player);
      if (state.selected["player-second"]?.id === player.id) { state.selected["player-second"] = null; $("#player-second").value = ""; }
      updateCompareButton("players"); location.hash = "players";
      toast("Player selected. Choose a second skater and compare their statistics.");
    }
  });
}
