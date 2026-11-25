// Token Launch Radar page: renders window.RADAR (written by main.ts from the sealed
// snapshot) as a sortable, filterable board with a per-protocol detail view and farm
// plan. No fetch, no network: every number on the page comes from data.js, and the
// detail view recomputes the implied value from the row's own model multipliers so
// the page and board.json cannot drift apart. Views are shareable through the query
// string: ?detail=<slug>, ?cat=<category>, ?chain=<chain>, ?watch=1, ?sort=<key>.

(function () {
  'use strict';
  var R = window.RADAR;
  var main = document.getElementById('board');
  if (!R || !main) return;

  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'implied',
    detail: params.get('detail') || (R.rows.length ? R.rows[0].slug : ''),
  };

  function fmt(n) {
    if (n === null || n === undefined) return '—';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined) return '<span class="chains">n/a</span>';
    var cls = n >= 0 ? 'up' : 'down';
    return '<span class="' + cls + '">' + (n >= 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 730) return Math.floor(days / 365) + 'y ' + Math.floor((days % 365) / 30) + 'm';
    if (days >= 30) return Math.floor(days / 30) + ' months';
    return days + ' days';
  }
  function confClass(c) { return c >= 75 ? 'hi' : c >= 55 ? 'mid' : ''; }

  var categories = [];
  var chains = [];
  R.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort(); chains.sort();

  var maxImplied = R.rows.length ? R.rows[0].implied_value_usd : 1;

  function visibleRows() {
    var rows = R.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(state.q.toLowerCase()) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    rows.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d === null ? -999 : b.change_7d) - (a.change_7d === null ? -999 : a.change_7d);
      if (key === 'age') return (b.age_days || 0) - (a.age_days || 0);
      if (key === 'confidence') return b.confidence - a.confidence;
      return b.implied_value_usd - a.implied_value_usd;
    });
    return rows;
  }

  function rowHtml(r) {
    var chainsTxt = r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
    return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === state.detail ? ' class="sel"' : '') + '>' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><span class="pname">' + esc(r.name) + '</span>' + (r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
      '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td class="cat">' + esc(r.category || '—') + '</td>' +
      '<td class="chains">' + esc(chainsTxt) + '</td>' +
      '<td class="num">' + fmt(r.tvl_usd) + '</td>' +
      '<td class="num">' + pct(r.change_7d) + '</td>' +
      '<td class="num"><b>' + fmt(r.implied_value_usd) + '</b><div class="bar"><i style="width:' + Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%"></i></div></td>' +
      '<td><span class="conf ' + confClass(r.confidence) + '">' + r.confidence + '</span></td></tr>';
  }

  function detailHtml(r) {
    if (!r) return '<div class="detail"><p class="empty">Select a protocol on the board to see its model breakdown and farm plan.</p></div>';
    var m = r.model;
    var base = r.tvl_usd * m.peer_multiple;
    var steps = r.farm_steps.map(function (s, i) {
      var costAt = s.indexOf(' Cost: ');
      var head = costAt >= 0 ? s.slice(0, costAt) : s;
      var tail = costAt >= 0 ? s.slice(costAt + 1) : '';
      return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(head) + (tail ? '<br><span>' + esc(tail) + '</span>' : '') + '</li>';
    }).join('');
    return '<div class="detail"><h2>' + esc(r.name) + (r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<div class="sub">' + esc(r.slug) + ' · records no token · tracked since ' + esc(r.listed_at || 'unknown') + '</div>' +
      '<div class="kv">' +
      '<div><span>Implied value</span><b>' + fmt(r.implied_value_usd) + '</b></div>' +
      '<div><span>Rank</span><b>#' + r.rank + ' of ' + R.board_size + '</b></div>' +
      '<div><span>TVL</span><b>' + fmt(r.tvl_usd) + '</b></div>' +
      '<div><span>7d TVL change</span><b>' + (r.change_7d === null ? 'n/a' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b></div>' +
      '<div><span>Category</span><b>' + esc(r.category || '—') + '</b></div>' +
      '<div><span>Age with no token</span><b>' + ageLabel(r.age_days) + '</b></div>' +
      '<div><span>Chains</span><b>' + esc(r.chains.join(', ') || '—') + '</b></div>' +
      '<div><span>Confidence</span><b>' + r.confidence + ' / 100</b></div></div>' +
      '<div class="water"><h3>How the value is built</h3>' +
      '<div class="wrow"><span>TVL x peer multiple (' + esc(m.peer_source === 'category' ? (r.category || 'category') + ', ' + m.peer_count + ' live peers' : 'global live median') + ')</span><b>' + fmt(r.tvl_usd) + ' x ' + m.peer_multiple.toFixed(3) + '</b></div>' +
      '<div class="wrow"><span>Base value</span><b>' + fmt(base) + '</b></div>' +
      '<div class="wrow"><span>x growth (7d ' + (m.growth_pct === null ? 'unreported, scored 0.97' : m.growth_pct.toFixed(1) + '%') + ')</span><b>x ' + m.growth_multiplier.toFixed(3) + '</b></div>' +
      '<div class="wrow"><span>x maturity (' + ageLabel(m.age_days) + ' with no token)</span><b>x ' + m.maturity_multiplier.toFixed(3) + '</b></div>' +
      '<div class="wrow"><span>x breadth (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</span><b>x ' + m.breadth_multiplier.toFixed(3) + '</b></div>' +
      '<div class="wrow total"><span>Implied value</span><b>' + fmt(r.implied_value_usd) + '</b></div>' +
      '<p style="color:var(--dim);margin:8px 0 0">Peer multiple is the median market-cap / TVL the market pays live-token protocols in the same category, shrunk toward the global median (' + R.global_peer_multiple.toFixed(3) + ') by sample size. The implied value is this radar\u2019s own claim about a launch at today\u2019s record — not a prediction that a token will be issued.</p></div>' +
      '<div class="farm"><h3>Farm plan — do this, in this order</h3><ol>' + steps + '</ol></div></div>';
  }

  function render() {
    var rows = visibleRows();
    var sel = null;
    rows.forEach(function (r) { if (r.slug === state.detail) sel = r; });
    if (!sel && rows.length) sel = rows[0];
    var catOpts = '<option value="">All categories</option>' + categories.map(function (c) {
      return '<option' + (c === state.cat ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainOpts = '<option value="">All chains</option>' + chains.map(function (c) {
      return '<option' + (c === state.chain ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var sortOpts = [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7d growth'], ['age', 'Age, no token'], ['confidence', 'Confidence']].map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === state.sort ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
    var peerRows = R.peers.map(function (p) {
      return '<tr><td>' + esc(p.category) + '</td><td class="num">' + p.peers + '</td><td class="num">' + p.median_multiple.toFixed(3) + 'x</td></tr>';
    }).join('');
    var liveRows = R.live.map(function (p) {
      return '<tr><td><span class="pname">' + esc(p.name) + '</span></td><td class="num">' + fmt(p.mcap_usd) + '</td><td class="num">' + fmt(p.tvl_usd) + '</td><td class="num">' + (p.mcap_tvl === null ? '—' : p.mcap_tvl.toFixed(3) + 'x') + '</td></tr>';
    }).join('');

    main.innerHTML =
      '<header class="top"><div><h1>Token Launch <span class="rad">Radar</span></h1>' +
      '<p class="tagline">Every protocol that records no token yet, ranked by what a launch would be worth at today\u2019s record — with the farm plan for each. The watchlist is the floor, not the ceiling: the board also carries the early finds below it.</p></div>' +
      '<div class="asof">Snapshot ' + esc(R.as_of) + '<br>Model ' + esc(R.model_version) + ' · offline, no network</div></header>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + R.scanned_size + '</b><span>protocols scanned</span></div>' +
      '<div class="stat"><b>' + R.board_size + '</b><span>pre-token protocols ranked</span></div>' +
      '<div class="stat"><b>' + R.watchlist_size + ' / ' + R.watchlist_size + '</b><span>watchlist covered</span></div>' +
      '<div class="stat"><b>' + fmt(R.total_implied_usd) + '</b><span>total implied value</span></div>' +
      '<div class="stat"><b>' + R.live_size + '</b><span>live-token protocols set aside as peers</span></div></div>' +
      '<div class="model"><h2>The value model — ' + esc(R.model_version) + '</h2>' +
      '<p><code>implied = TVL x peerMultiple x growth x maturity x breadth</code></p>' +
      '<p>Peer multiple: the median market-cap / TVL of live-token protocols in the same category (global median ' + R.global_peer_multiple.toFixed(3) + 'x when a category has under 3 peers), so a launch is priced the way the market already prices its traded neighbours. Growth uses the 7-day TVL change, clamped; an unreported change scores 0.97, never free momentum. Maturity rewards a longer record with no token; breadth rewards distribution across chains. Wrapped, staked, bridged and versioned products of tokens that already trade are excluded — they are not launches waiting to happen. Confidence (0-100) grades the record behind each number; it never moves the price.</p></div>' +
      '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name, slug, category" value="' + esc(state.q) + '">' +
      '<select id="cat">' + catOpts + '</select>' +
      '<select id="chain">' + chainOpts + '</select>' +
      '<label><input type="checkbox" id="watch"' + (state.watch ? ' checked' : '') + '> Watchlist only</label>' +
      '<label>Sort <select id="sort">' + sortOpts + '</select></label>' +
      '<span class="count">' + rows.length + ' shown</span></div>' +
      '<div class="layout"><div>' +
      (rows.length
        ? '<table><thead><tr><th class="num">#</th><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Implied value</th><th>Conf.</th></tr></thead><tbody>' + rows.map(rowHtml).join('') + '</tbody></table>'
        : '<div class="empty">No protocol matches this filter. Clear the search or pick another category or chain.</div>') +
      '</div>' + detailHtml(sel) + '</div>' +
      '<section class="lower">' +
      '<div class="box peers"><h2>Peer pricing — what a TVL dollar already trades for</h2>' +
      '<p>Median market-cap / TVL among live-token protocols, by category. These are the multiples the board prices pre-token protocols with.</p>' +
      '<table><thead><tr><th>Category</th><th class="num">Live peers</th><th class="num">Median mcap / TVL</th></tr></thead><tbody>' + peerRows + '</tbody></table></div>' +
      '<div class="box"><h2>Live tokens — set aside, never ranked</h2>' +
      '<p>These protocols already trade, so the radar shows the market\u2019s own value for them and keeps them out of the launch ranking.</p>' +
      '<table><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">Mcap / TVL</th></tr></thead><tbody>' + liveRows + '</tbody></table></div>' +
      '</section>' +
      '<footer><p>Source: ' + esc(R.source) + '. Floor for the house watchlist: ' + fmt(R.floor_usd) + ' TVL. A protocol here records no token in that record — that is not proof it has none.</p>' +
      '<p>Implied values are this radar\u2019s own claims, computed from the snapshot alone by the stated model. They are not make.fun\u2019s claims, not prices, and not a prediction that any token will be issued. Farm plans carry real cost and risk; check a protocol\u2019s own page before acting.</p></footer>';
    main.setAttribute('aria-busy', 'false');

    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; rerenderKeepFocus('q'); });
    document.getElementById('cat').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
    document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
    document.getElementById('watch').addEventListener('change', function (e) { state.watch = e.target.checked; render(); });
    document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
    Array.prototype.forEach.call(main.querySelectorAll('tbody tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { state.detail = tr.getAttribute('data-slug'); render(); });
    });
  }
  function rerenderKeepFocus(id) {
    render();
    var el = document.getElementById(id);
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
  render();
})();
