/* Food Manager — a single-file, no-build household food planner.
   All data lives in this browser's localStorage (see Settings for backup). */
'use strict';

// ---------- constants ----------
const KEY = 'foodmanager.v1';
const CATS = ['Produce', 'Meat & Fish', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Frozen', 'Other'];
const PERISHABLE = new Set(['Produce', 'Meat & Fish', 'Dairy & Eggs', 'Bakery']);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FRESH_WARN = 4, FRESH_BAD = 7;      // days since bought
const LEFT_WARN = 2, LEFT_BAD = 4;        // days since cooked
const SLOT_LABEL = { leftovers: 'Leftovers night', flex: 'Flex night (use what we have)', out: 'Eating out' };

const UNIT_ALIASES = {
  cups: 'cup', tablespoon: 'tbsp', tablespoons: 'tbsp', teaspoon: 'tsp', teaspoons: 'tsp',
  ounce: 'oz', ounces: 'oz', pound: 'lb', pounds: 'lb', lbs: 'lb', grams: 'g', gram: 'g',
  cans: 'can', cloves: 'clove', slices: 'slice', package: 'pkg', packages: 'pkg',
  bunches: 'bunch', heads: 'head', sticks: 'stick', jars: 'jar', bags: 'bag',
};
const UNITS = new Set(['cup', 'tbsp', 'tsp', 'oz', 'lb', 'g', 'kg', 'ml', 'l', 'can', 'clove', 'slice',
  'pkg', 'bunch', 'head', 'stick', 'jar', 'bag', 'pinch']);

// First match wins, so specific pantry phrases come before the broad fresh-food words.
const CAT_WORDS = [
  ['Frozen', ['frozen']],
  ['Pantry', ['black pepper', 'tomato sauce', 'tomato paste', 'canned', 'broth', 'stock', 'powder',
    'peanut butter', 'coconut milk', 'dried', 'crushed tomatoes', 'diced tomatoes', 'beans']],
  ['Meat & Fish', ['chicken', 'beef', 'pork', 'turkey', 'sausage', 'bacon', 'salmon', 'fish', 'shrimp', 'ham', 'steak', 'lamb', 'tuna']],
  ['Dairy & Eggs', ['milk', 'cheese', 'butter', 'yogurt', 'cream', 'egg', 'parmesan', 'mozzarella', 'cheddar', 'feta']],
  ['Bakery', ['bread', 'tortilla', 'bun', 'rolls', 'pita', 'naan', 'bagel']],
  ['Produce', ['onion', 'garlic', 'tomato', 'lettuce', 'spinach', 'carrot', 'pepper', 'potato', 'broccoli',
    'lemon', 'lime', 'apple', 'banana', 'cilantro', 'basil', 'parsley', 'celery', 'mushroom', 'zucchini',
    'cucumber', 'avocado', 'ginger', 'kale', 'cabbage', 'berries', 'scallion', 'squash', 'corn', 'herb',
    'cauliflower', 'green bean', 'asparagus', 'orange', 'grape', 'salad']],
  ['Pantry', ['rice', 'pasta', 'flour', 'sugar', 'oil', 'vinegar', 'sauce', 'spice', 'salt', 'cumin', 'paprika',
    'oregano', 'honey', 'soy', 'noodle', 'lentil', 'oats', 'cereal', 'salsa', 'mustard', 'ketchup', 'mayo',
    'spaghetti', 'penne', 'quinoa', 'chili', 'cinnamon', 'vanilla', 'nuts', 'coffee', 'tea']],
];

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s).trim().toLowerCase();

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => iso(new Date());
const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
const daysSince = (s) => Math.round((fromIso(today()) - fromIso(s)) / 86400000);
const shortDate = (s) => fromIso(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const ago = (n) => (n <= 0 ? 'today' : n === 1 ? '1 day' : `${n} days`);

function weekStartOf(dateIso) {
  const d = fromIso(dateIso);
  const diff = (d.getDay() - state.settings.weekStart + 7) % 7;
  return addDays(dateIso, -diff);
}

function fmtQty(q) {
  if (q == null) return '';
  const r = Math.round(q * 100) / 100;
  return String(r);
}

function guessCat(name) {
  const n = norm(name);
  for (const [cat, words] of CAT_WORDS) if (words.some((w) => n.includes(w))) return cat;
  return 'Other';
}

function parseQty(s) {
  const fr = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
  let total = 0, ok = false;
  for (const p of s.trim().split(/\s+/)) {
    if (fr[p] != null) { total += fr[p]; ok = true; }
    else if (/^\d+\/\d+$/.test(p)) { const [a, b] = p.split('/').map(Number); if (b) { total += a / b; ok = true; } }
    else if (/^\d*\.?\d+$/.test(p)) { total += parseFloat(p); ok = true; }
  }
  return ok ? total : null;
}

// "1 1/2 cups rice" -> { qty: 1.5, unit: 'cup', name: 'rice', cat: 'Pantry' }
function parseIngredient(line) {
  line = line.replace(/(\d)([½¼¾⅓⅔])/, '$1 $2');
  const m = line.trim().match(/^((?:\d+\/\d+|\d*\.?\d+|[½¼¾⅓⅔])(?:\s+(?:\d+\/\d+|[½¼¾⅓⅔]))?)?\s*(.*)$/);
  const qty = m[1] ? parseQty(m[1]) : null;
  let rest = m[2].trim();
  let unit = '';
  const words = rest.split(/\s+/);
  if (qty != null && words.length > 1) {
    const w = norm(words[0]).replace(/\.$/, '');
    const u = UNIT_ALIASES[w] || w;
    if (UNITS.has(u)) { unit = u; rest = words.slice(1).join(' ').replace(/^of\s+/i, ''); }
  }
  return { qty, unit, name: rest, cat: guessCat(rest) };
}
// Turn pasted recipe text (from a website, message or note) into a draft recipe.
function parseRecipeText(text) {
  const clean = (l) => l.replace(/^[\s•\-–*▢☐□·]+/, '').trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const isIngHead = (l) => /^ingredients?\b.{0,20}$/i.test(l);
  const isStepHead = (l) => /^(instructions?|directions?|method|steps|preparation|how to make( it)?)\b.{0,20}$/i.test(l);
  const looksLikeIngredient = (l) => /^[\s•\-–*▢☐□·]*(\d|[½¼¾⅓⅔])/.test(l) && l.length < 70 && !/^\d+[.)]\s/.test(l);
  const url = (text.match(/https?:\/\/\S+/) || [''])[0];
  const sv = text.match(/(?:serves|servings?|yields?|makes)\D{0,10}(\d{1,2})/i);
  const iName = lines.findIndex((l) => !isIngHead(l) && !isStepHead(l) && !/^https?:/i.test(l));
  const iIng = lines.findIndex(isIngHead), iStep = lines.findIndex(isStepHead);
  let ing, steps;
  if (iIng >= 0) {
    ing = lines.slice(iIng + 1, iStep > iIng ? iStep : lines.length);
    steps = iStep > iIng ? lines.slice(iStep + 1) : iStep >= 0 ? lines.slice(iStep + 1, iIng) : [];
  } else {
    const body = lines.slice(iName + 1).filter((l) => !/^https?:/i.test(l));
    const cut = iStep > iName ? iStep - iName - 1 : body.length;
    ing = body.slice(0, cut).filter(looksLikeIngredient);
    steps = body.filter((l, n) => !(n < cut && looksLikeIngredient(l)) && !isStepHead(l));
  }
  const end = steps.findIndex((l) => /^nutrition\b/i.test(l));
  if (end >= 0) steps = steps.slice(0, end);
  return {
    name: iName >= 0 ? clean(lines[iName]).slice(0, 80) : '',
    servings: sv ? Math.max(1, parseInt(sv[1], 10)) : state.settings.servings,
    ingredients: ing.map(clean).filter((l) => l && !/:$/.test(l) && !/^https?:/i.test(l)).map(parseIngredient),
    steps: steps.join('\n'),
    source: url,
  };
}
const splitItems = (text) => String(text).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);

const ingredientLine = (i) => [fmtQty(i.qty), i.unit, i.name].filter(Boolean).join(' ');

// Loose match between an ingredient and something on hand ("spinach" ~ "baby spinach").
function sameFood(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// ---------- state ----------
function defaults() {
  const staple = (name) => ({ id: uid(), name, cat: guessCat(name), target: 1, have: 1 });
  const recipe = (name, servings, lines, steps) => ({
    id: uid(), name, servings, ingredients: lines.map(parseIngredient), steps, source: '',
    rating: null, madeCount: 0, lastMade: null, planServings: null,
  });
  return {
    settings: { servings: 4, weekStart: 0, locations: ['Main fridge', 'Kitchen pantry', 'Garage fridge', 'Storage room'] },
    recipes: [
      recipe('Sheet-Pan Chicken & Vegetables', 4,
        ['1.5 lb chicken thighs', '1 lb potatoes', '2 carrots', '1 head broccoli', '2 tbsp olive oil', '1 tsp paprika', 'salt'],
        'Heat oven to 425°F. Cut the potatoes and carrots into chunks, toss with oil, paprika and salt on a sheet pan with the chicken. Roast 20 minutes, add broccoli, roast 15 minutes more until the chicken is cooked through.'),
      recipe('Black Bean Tacos', 4,
        ['2 can black beans', '8 tortillas', '1 onion', '1 avocado', '1 cup shredded cheese', '1 jar salsa', '1 tsp cumin'],
        'Soften the chopped onion in a pan, add drained beans and cumin, and warm through, mashing lightly. Serve in warm tortillas with cheese, avocado and salsa.'),
      recipe('One-Pot Tomato Pasta', 4,
        ['12 oz penne', '1 can crushed tomatoes', '2 clove garlic', '3 cup baby spinach', '0.5 cup parmesan', '1 tbsp olive oil'],
        'Cook garlic in oil for a minute. Add tomatoes, pasta and 3 cups water; simmer about 12 minutes, stirring, until the pasta is tender. Stir in spinach until wilted and top with parmesan.'),
    ],
    weeks: {},
    list: [],
    fresh: [],
    leftovers: [],
    staples: ['Milk', 'Eggs', 'Butter', 'Bread', 'Rice', 'Pasta', 'Olive oil', 'Onions', 'Garlic', 'Salt',
      'Flour', 'Sugar', 'Coffee', 'Cereal'].map(staple),
    wasteLog: [],
    freq: {},
  };
}

let state;
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? Object.assign(defaults(), JSON.parse(raw)) : defaults();
  } catch (e) {
    state = defaults();
  }
  migrate();
}
// Fill in anything older saved data (or an imported backup) is missing.
function migrate() {
  state.settings = { ...defaults().settings, ...state.settings };
  if (!Array.isArray(state.settings.locations) || !state.settings.locations.length) state.settings.locations = defaults().settings.locations;
  const known = new Set(locs());
  for (const x of [...state.fresh, ...state.leftovers]) if (!known.has(x.loc)) x.loc = locs()[0];
  for (const x of state.fresh) if (!x.kind) x.kind = 'fresh';
  // Staples carry a safety-stock level ("keep") and a count ("have"), and live in one place.
  const store = locs().find((l) => /storage|pantry|basement|cupboard/i.test(l)) || locs()[0];
  for (const x of state.staples) {
    if (!(x.target >= 1)) x.target = 1;
    if (!(x.have >= 0)) x.have = x.low ? 0 : x.target;
    delete x.low;
    if (!known.has(x.loc)) x.loc = PERISHABLE.has(x.cat) ? locs()[0] : store;
  }
}
const locs = () => state.settings.locations;
function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  if (!sync) return;
  for (const k of SECTIONS) if (JSON.stringify(state[k]) !== pushed[k] && !sync.dirty.includes(k)) sync.dirty.push(k);
  saveSync();
  flush();
}

const ui = { tab: 'home', week: null, recipeFilter: 'all', q: '', editStaples: false };

function getWeek(start) {
  if (!state.weeks[start]) state.weeks[start] = { days: Array(7).fill(null), checked: {}, listBuilt: false, shopped: false };
  const wk = state.weeks[start];
  if (!wk.checked) wk.checked = wk.checkDone ? Object.fromEntries(locs().map((l) => [l, true])) : {};
  return wk;
}
const recipeById = (id) => state.recipes.find((r) => r.id === id);
const plannedServings = (r) => r.planServings || state.settings.servings;
const weekLabel = (start) => `${shortDate(start)} – ${shortDate(addDays(start, 6))}`;

const perishables = () => state.fresh.filter((f) => f.kind !== 'stock');
const uncheckedLocs = (wk) => locs().filter((l) => !wk.checked[l]);
// Anything listed in any location that matches a name (fresh first, then stored).
function onHand(name) {
  return perishables().find((f) => sameFood(f.name, name)) || state.fresh.find((f) => sameFood(f.name, name));
}

// Fresh items a recipe would use up.
function usesFresh(r) {
  return perishables().filter((f) => r.ingredients.some((i) => sameFood(i.name, f.name)));
}

// ---------- shopping list ----------
function buildList() {
  const wk = getWeek(ui.week);
  const merged = new Map();
  for (const d of wk.days) {
    if (!d || d.type !== 'recipe' || d.cooked) continue;
    const r = recipeById(d.recipeId);
    if (!r) continue;
    const factor = d.servings / (r.servings || 1);
    for (const i of r.ingredients) {
      const key = `${norm(i.name)}|${i.unit}`;
      const e = merged.get(key) || { key, name: i.name, unit: i.unit, qty: null, cat: i.cat, for: [] };
      if (i.qty != null) e.qty = (e.qty || 0) + i.qty * factor;
      if (!e.for.includes(r.name)) e.for.push(r.name);
      merged.set(key, e);
    }
  }
  const previous = new Map(state.list.filter((i) => i.source === 'plan').map((i) => [i.key, i]));
  const short = (id) => state.staples.some((x) => x.id === id && x.have < x.target);
  const list = state.list.filter((i) => i.source !== 'plan' && !(i.source === 'staple' && i.status === 'need' && !short(i.stapleId)));

  for (const e of merged.values()) {
    const old = previous.get(e.key);
    let status = old ? old.status : 'need';
    let hint = '';
    if (!old) {
      // Shop the kitchen first: assume stocked staples and fresh items already on hand.
      const staple = state.staples.find((s) => sameFood(s.name, e.name));
      const fresh = onHand(e.name);
      if (fresh) { status = 'have'; hint = `in the ${fresh.loc}`; }
      else if (staple && staple.have > 0) { status = 'have'; hint = `${staple.have} in the ${staple.loc}`; }
    }
    list.push({ id: old ? old.id : uid(), source: 'plan', status, hint: old ? old.hint : hint, ...e });
  }
  // Staples below their safety stock: buy enough to get back up to the "keep" level.
  for (const s of state.staples.filter((x) => x.have < x.target)) {
    const key = `staple|${s.id}`;
    const qty = s.target - s.have;
    const mine = list.find((i) => i.key === key);
    if (mine) { mine.qty = qty; continue; }
    if (list.some((i) => i.status !== 'have' && sameFood(i.name, s.name))) continue;
    list.push({ id: uid(), source: 'staple', stapleId: s.id, key, name: s.name, unit: '', qty, cat: s.cat, status: 'need', hint: '', for: [] });
  }
  state.list = list;
  wk.listBuilt = true;
}

function finishShopping() {
  const bought = state.list.filter((i) => i.status === 'bought');
  for (const i of bought) {
    if (PERISHABLE.has(i.cat) && !perishables().some((f) => norm(f.name) === norm(i.name))) {
      state.fresh.push({ id: uid(), name: i.name, added: today(), loc: locs()[0], kind: 'fresh' });
    }
    const s = state.staples.find((x) => x.id === i.stapleId) || state.staples.find((x) => sameFood(x.name, i.name));
    if (s) s.have = i.source === 'staple' ? s.have + (i.qty || 1) : Math.max(s.have, 1);
  }
  state.list = state.list.filter((i) => i.status === 'need');
  getWeek(ui.week).shopped = true;
  return bought.length;
}

function listAsText() {
  const need = state.list.filter((i) => i.status === 'need');
  return CATS.map((cat) => {
    const items = need.filter((i) => i.cat === cat);
    if (!items.length) return '';
    return `${cat}\n` + items.map((i) => `- ${[fmtQty(i.qty), i.unit, i.name].filter(Boolean).join(' ')}`).join('\n');
  }).filter(Boolean).join('\n\n');
}

// ---------- views ----------
function ageBadge(days, warn, bad) {
  const cls = days >= bad ? 'bad' : days >= warn ? 'warn' : '';
  return `<span class="badge ${cls}">${ago(days)}</span>`;
}

function dayTitle(d) {
  if (!d) return '<span class="muted">Nothing planned</span>';
  if (d.type === 'recipe') {
    const r = recipeById(d.recipeId);
    return r ? esc(r.name) : '<span class="muted">Deleted recipe</span>';
  }
  return esc(SLOT_LABEL[d.type]);
}

function viewHome() {
  const wk = getWeek(ui.week);
  const planned = wk.days.filter(Boolean).length;
  const unchecked = uncheckedLocs(wk);
  const steps = [
    ['kitchen', 'Kitchen check', unchecked.length ? `Still to check: ${esc(unchecked.join(', '))}` : `All ${locs().length} places checked`, !unchecked.length],
    ['plan', 'Plan the menu', planned ? `${planned} of 7 nights planned` : 'Start with what needs using up', planned >= 5],
    ['list', 'Build the shopping list', 'Made from the menu, minus what you already have', wk.listBuilt],
    ['list', 'Shop', 'Check items off in the store, then tap Finish', wk.shopped],
  ];

  const thisWeek = weekStartOf(today());
  const idx = Math.round((fromIso(today()) - fromIso(thisWeek)) / 86400000);
  const tonight = getWeek(thisWeek).days[idx];
  let tonightHtml;
  if (!tonight) {
    tonightHtml = `<p class="empty">Nothing planned for tonight.</p>
      <div class="actions"><button class="btn" data-action="pick-day" data-week="${thisWeek}" data-idx="${idx}">Choose something</button></div>`;
  } else if (tonight.type === 'recipe') {
    const r = recipeById(tonight.recipeId);
    tonightHtml = `<div class="meal">${dayTitle(tonight)}</div>
      <small class="muted">${tonight.cooked ? 'Cooked' : `Cooking for ${tonight.servings}`}</small>
      <div class="actions">
        ${r ? `<button class="btn" data-action="view-recipe" data-id="${r.id}">Recipe</button>` : ''}
        ${tonight.cooked ? '' : `<button class="btn primary" data-action="cook" data-week="${thisWeek}" data-idx="${idx}">We cooked it</button>
        <button class="btn" data-action="move-day" data-week="${thisWeek}" data-idx="${idx}">Not tonight</button>`}
      </div>`;
  } else {
    tonightHtml = `<div class="meal">${dayTitle(tonight)}</div>
      <div class="actions"><button class="btn" data-action="pick-day" data-week="${thisWeek}" data-idx="${idx}">Change</button></div>`;
  }

  const urgent = [
    ...state.leftovers.map((l) => ({ name: l.name, kind: `Leftovers · ${l.loc}`, days: daysSince(l.made), warn: LEFT_WARN, bad: LEFT_BAD })),
    ...perishables().map((f) => ({ name: f.name, kind: f.loc, days: daysSince(f.added), warn: FRESH_WARN, bad: FRESH_BAD })),
  ].filter((x) => x.days >= x.warn).sort((a, b) => (b.days / b.bad) - (a.days / a.bad));

  const month = today().slice(0, 7);
  const tossed = state.wasteLog.filter((w) => w.date.startsWith(month)).length;

  return `
    <h2>Tonight</h2>
    <div class="card day today">${tonightHtml}</div>

    <h2>Use these first</h2>
    <div class="card tight">
      ${urgent.length ? urgent.slice(0, 6).map((x) => `
        <div class="row"><div class="grow"><b>${esc(x.name)}</b><span class="sub">${esc(x.kind)}</span></div>${ageBadge(x.days, x.warn, x.bad)}</div>`).join('')
      : '<p class="empty">Nothing is getting old. Nice work.</p>'}
    </div>
    ${urgent.length ? '<button class="btn block" data-tab="kitchen">Open kitchen</button>' : ''}

    <h2>Weekly routine <small>${weekLabel(ui.week)}</small></h2>
    <div class="card tight">
      ${steps.map(([tab, title, sub, ok], n) => `
        <button class="step ${ok ? 'ok' : ''}" data-tab="${tab}">
          <span class="num">${ok ? '&#10003;' : n + 1}</span>
          <span><b>${title}</b><br><small class="muted">${sub}</small></span>
        </button>`).join('')}
    </div>

    <h2>Food tossed this month</h2>
    <div class="card"><b>${tossed}</b> item${tossed === 1 ? '' : 's'}
      <small class="muted"> — tap “Tossed” in Kitchen whenever something is thrown out, so you can see the number shrink.</small></div>`;
}

function viewPlan() {
  const wk = getWeek(ui.week);
  const t = today();
  const cooked = wk.days.filter((d) => d && d.type === 'recipe').length;
  const buffer = wk.days.filter((d) => d && (d.type === 'leftovers' || d.type === 'flex')).length;
  let tip = '';
  if (cooked >= 6 && !buffer) tip = 'Six or more cooked meals and no leftovers or flex night. Plans change — leaving one or two open nights is the easiest way to waste less.';
  else if (perishables().length && !cooked) tip = `You have ${perishables().length} fresh item${perishables().length === 1 ? '' : 's'} on hand. Recipes that use them are listed first when you pick a meal.`;

  return `
    <div class="weeknav">
      <button class="btn small" data-action="week" data-n="-7">&larr; Prev</button>
      <b>${weekLabel(ui.week)}</b>
      <button class="btn small" data-action="week" data-n="7">Next &rarr;</button>
    </div>
    ${uncheckedLocs(wk).length ? `<div class="note">Before planning, check: <b>${esc(uncheckedLocs(wk).join(', '))}</b>. <button class="btn small" data-tab="kitchen">Open kitchen</button></div>` : ''}
    ${tip ? `<div class="note">${tip}</div>` : ''}
    ${wk.days.map((d, i) => {
      const date = addDays(ui.week, i);
      const r = d && d.type === 'recipe' ? recipeById(d.recipeId) : null;
      return `
      <div class="card day ${date === t ? 'today' : ''} ${d && d.cooked ? 'done' : ''}">
        <div class="dayname">${DAYS[fromIso(date).getDay()]} · ${shortDate(date)}</div>
        <div class="meal grow">${dayTitle(d)}</div>
        ${d && d.type === 'recipe' ? `<small class="muted">${d.cooked ? 'Cooked' : `For ${d.servings}`}</small>` : ''}
        <div class="actions">
          <button class="btn small" data-action="pick-day" data-week="${ui.week}" data-idx="${i}">${d ? 'Change' : 'Choose'}</button>
          ${d ? `<button class="btn small" data-action="move-day" data-week="${ui.week}" data-idx="${i}">Move</button>` : ''}
          ${r ? `<button class="btn small" data-action="view-recipe" data-id="${r.id}">Recipe</button>` : ''}
          ${r && !d.cooked ? `<button class="btn small" data-action="servings" data-week="${ui.week}" data-idx="${i}">Servings</button>
            <button class="btn small primary" data-action="cook" data-week="${ui.week}" data-idx="${i}">Cooked</button>` : ''}
        </div>
      </div>`;
    }).join('')}
    <button class="btn primary block" data-action="build-list">Build shopping list from this menu</button>`;
}

function viewList() {
  const need = state.list.filter((i) => i.status !== 'have');
  const have = state.list.filter((i) => i.status === 'have');
  const boughtCount = need.filter((i) => i.status === 'bought').length;
  const row = (i) => `
    <div class="row ${i.status === 'bought' ? 'done' : ''}">
      <button class="check ${i.status === 'bought' ? 'on' : ''}" data-action="toggle-bought" data-id="${i.id}" aria-label="Bought">${i.status === 'bought' ? '&#10003;' : ''}</button>
      <div class="grow"><b>${esc(i.name)}</b> ${esc([fmtQty(i.qty), i.unit].filter(Boolean).join(' '))}
        ${i.for && i.for.length ? `<span class="sub">${esc(i.for.join(', '))}</span>` : i.source === 'staple' ? '<span class="sub">Staple below safety stock</span>' : ''}</div>
      ${i.status === 'need' ? `<button class="btn small" data-action="have" data-id="${i.id}">Have it</button>` : ''}
    </div>`;

  return `
    <form class="inline" data-form="add-item">
      <input type="text" name="name" placeholder="Add items — commas between several" autocomplete="off" required>
      <button class="btn primary">Add</button>
    </form>
    ${frequentItems().length ? `<div class="chips" style="margin-top:8px">${frequentItems().map((n) => `<button class="chip" data-action="quick-add" data-name="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>` : ''}
    <div class="actions">
      <button class="btn small" data-action="build-list">Rebuild from menu (${weekLabel(ui.week)})</button>
      <button class="btn small" data-action="share-list">Share / copy</button>
    </div>
    ${need.length ? CATS.map((cat) => {
      const items = need.filter((i) => i.cat === cat);
      return items.length ? `<h2>${cat}</h2><div class="card tight">${items.map(row).join('')}</div>` : '';
    }).join('') : '<p class="empty">The list is empty. Plan a menu, then tap “Rebuild from menu”.</p>'}
    ${have.length ? `<h2>Already have <small>not on the list — tap to add back</small></h2>
      <div class="card tight">${have.map((i) => `
        <div class="row"><div class="grow">${esc(i.name)} ${esc([fmtQty(i.qty), i.unit].filter(Boolean).join(' '))}
          ${i.hint ? `<span class="sub">${esc(i.hint)}</span>` : ''}</div>
          <button class="btn small" data-action="need" data-id="${i.id}">Need it</button></div>`).join('')}</div>` : ''}
    ${boughtCount ? `<button class="btn primary block" data-action="finish-shop">Finish shopping (${boughtCount} bought)</button>` : ''}`;
}

function recipeMeta(r) {
  const bits = [];
  if (r.rating === 'love') bits.push('<span class="badge">Make again</span>');
  if (r.rating === 'no') bits.push('<span class="badge bad">Not again</span>');
  bits.push(`<small class="muted">${r.madeCount ? `Made ${r.madeCount}× · last ${shortDate(r.lastMade)}` : 'Not made yet'}</small>`);
  return bits.join(' ');
}

function recipeListHtml() {
  const q = norm(ui.q);
  const list = state.recipes.filter((r) => {
    if (ui.recipeFilter === 'love' && r.rating !== 'love') return false;
    if (ui.recipeFilter === 'new' && r.madeCount) return false;
    if (ui.recipeFilter === 'all' && r.rating === 'no' && !q) return false;
    if (ui.recipeFilter === 'no' && r.rating !== 'no') return false;
    return !q || norm(r.name).includes(q) || r.ingredients.some((i) => norm(i.name).includes(q));
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (!list.length) return '<p class="empty">No recipes here yet.</p>';
  return `<div class="card tight">${list.map((r) => `
    <div class="row"><div class="grow"><b>${esc(r.name)}</b><span class="sub">${recipeMeta(r)}</span></div>
      <button class="btn small" data-action="view-recipe" data-id="${r.id}">Open</button></div>`).join('')}</div>`;
}

function viewRecipes() {
  const chip = (id, label) => `<button class="chip ${ui.recipeFilter === id ? 'on' : ''}" data-action="recipe-filter" data-id="${id}">${label}</button>`;
  return `
    <div class="inline">
      <input type="search" id="recipe-q" placeholder="Search name or ingredient…" value="${esc(ui.q)}">
      <button class="btn primary" data-action="new-recipe">New</button>
    </div>
    <div class="chips" style="margin:10px 0">${chip('all', 'All')}${chip('love', 'Make again')}${chip('new', 'Not tried')}${chip('no', 'Not again')}</div>
    <div id="recipe-list">${recipeListHtml()}</div>`;
}

function itemRow(x, kind) {
  const sub = kind === 'left'
    ? `Leftovers${x.portions ? ` · ${x.portions} portion${x.portions === 1 ? '' : 's'}` : ''}`
    : x.kind === 'stock' ? 'Stored' : 'Fresh';
  const badge = kind === 'left' ? ageBadge(daysSince(x.made), LEFT_WARN, LEFT_BAD)
    : x.kind === 'stock' ? '' : ageBadge(daysSince(x.added), FRESH_WARN, FRESH_BAD);
  const a = kind === 'left' ? 'left' : 'fresh';
  return `
    <div class="row"><button class="grow namebtn" data-action="item-move" data-id="${x.id}"><b>${esc(x.name)}</b><span class="sub">${sub}</span></button>
      ${badge}
      <button class="btn small" data-action="${a}-done" data-id="${x.id}">${kind === 'left' ? 'Eaten' : 'Used'}</button>
      <button class="btn small danger" data-action="${a}-toss" data-id="${x.id}">Tossed</button></div>`;
}

function viewKitchen() {
  const wk = getWeek(ui.week);
  const missing = locs().filter((l) => !wk.checked[l]);
  return `
    <div class="note">Once a week, before planning, walk to <b>every</b> place below. Add what needs using up, count the staples kept there, then tick the place off. Tap a name to move or edit it.</div>

    ${locs().map((loc) => {
      const ok = wk.checked[loc];
      const left = state.leftovers.filter((x) => x.loc === loc).sort((a, b) => a.made.localeCompare(b.made));
      const items = state.fresh.filter((x) => x.loc === loc)
        .sort((a, b) => ((a.kind === 'stock') - (b.kind === 'stock')) || a.added.localeCompare(b.added));
      const staples = state.staples.filter((x) => x.loc === loc);
      const cold = /fridge|freezer/i.test(loc);
      const opt = (v, label, sel) => `<option value="${v}" ${sel ? 'selected' : ''}>${label}</option>`;
      return `
      <h2>${esc(loc)} ${ok ? '<span class="badge">Checked</span>' : '<span class="badge warn">Not checked yet</span>'}</h2>
      <div class="card tight">
        ${left.length || items.length ? left.map((x) => itemRow(x, 'left')).join('') + items.map((x) => itemRow(x, 'fresh')).join('')
        : '<p class="empty">Nothing listed here.</p>'}
      </div>
      ${staples.length ? `<div class="card tight">
        <div class="row"><small class="muted">Staples kept here — count what is unopened or spare</small></div>
        ${staples.map((x) => `
        <div class="row"><button class="grow namebtn" data-action="staple-open" data-id="${x.id}"><b>${esc(x.name)}</b>
            <span class="sub">Keep ${x.target}${x.have < x.target ? ` · <span class="badge warn">buy ${x.target - x.have}</span>` : ''}</span></button>
          <button class="btn small" data-action="staple-count" data-id="${x.id}" data-n="-1" aria-label="One fewer">&minus;</button>
          <b class="count">${x.have}</b>
          <button class="btn small" data-action="staple-count" data-id="${x.id}" data-n="1" aria-label="One more">+</button></div>`).join('')}
      </div>` : ''}
      <form class="inline" data-form="add-loc-item">
        <input type="hidden" name="loc" value="${esc(loc)}">
        <input type="text" name="name" placeholder="Add items — commas between several" autocomplete="off" required>
        <select name="kind" class="kind" aria-label="Kind">${opt('fresh', 'Fresh', cold)}${opt('left', 'Leftovers', false)}${opt('stock', 'Stored', !cold)}${opt('staple', 'Staple', false)}</select>
        <button class="btn">Add</button>
      </form>
      <button class="btn block ${ok ? '' : 'primary'}" data-action="loc-check" data-loc="${esc(loc)}">${ok ? `&#10003; ${esc(loc)} checked — undo` : `I’ve looked through the ${esc(loc)}`}</button>`;
    }).join('')}

    ${missing.length ? `<div class="note" style="margin-top:12px">Still to check this week: <b>${esc(missing.join(', '))}</b></div>`
    : '<button class="btn primary block" data-tab="plan">All places checked — plan the menu</button>'}`;
}

const VIEWS = { home: viewHome, plan: viewPlan, list: viewList, recipes: viewRecipes, kitchen: viewKitchen };
const TITLES = { home: 'Food Manager', plan: 'Weekly menu', list: 'Shopping list', recipes: 'Recipes', kitchen: 'Kitchen' };

function render() {
  $('#main').innerHTML = VIEWS[ui.tab]();
  $('#title').textContent = TITLES[ui.tab];
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
}
function commit() { save(); render(); }

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- dialogs ----------
const dialog = () => $('#dialog');
let onDialogSubmit = null;
function openDialog(html, onSubmit) {
  const d = dialog();
  d.innerHTML = html;
  onDialogSubmit = onSubmit || null;
  if (!d.open) d.showModal();
}
function closeDialog() { if (dialog().open) dialog().close(); }

function pickDayDialog(week, idx) {
  const date = addDays(week, idx);
  const ranked = state.recipes.filter((r) => r.rating !== 'no').map((r) => ({ r, uses: usesFresh(r) }))
    .sort((a, b) => (b.uses.length - a.uses.length)
      || ((b.r.rating === 'love') - (a.r.rating === 'love'))
      || String(a.r.lastMade || '').localeCompare(String(b.r.lastMade || '')));
  openDialog(`
    <h3>${DAYS[fromIso(date).getDay()]} ${shortDate(date)}</h3>
    <div class="chips">
      <button class="chip" data-action="set-slot" data-type="leftovers" data-week="${week}" data-idx="${idx}">Leftovers night</button>
      <button class="chip" data-action="set-slot" data-type="flex" data-week="${week}" data-idx="${idx}">Flex night</button>
      <button class="chip" data-action="set-slot" data-type="out" data-week="${week}" data-idx="${idx}">Eating out</button>
      <button class="chip" data-action="set-slot" data-type="" data-week="${week}" data-idx="${idx}">Clear</button>
    </div>
    <h2>Recipes</h2>
    <div class="card tight">
      ${ranked.length ? ranked.map(({ r, uses }) => `
        <div class="row"><div class="grow"><b>${esc(r.name)}</b>
          <span class="sub">${uses.length ? `<span class="badge warn">Uses up ${esc(uses.map((f) => f.name).join(', '))}</span> ` : ''}${recipeMeta(r)}</span></div>
          <button class="btn small primary" data-action="set-recipe" data-id="${r.id}" data-week="${week}" data-idx="${idx}">Pick</button></div>`).join('')
      : '<p class="empty">Add recipes in the Recipes tab first.</p>'}
    </div>
    <button class="btn block" data-action="close">Cancel</button>`);
}

function moveDayDialog(week, idx) {
  const wk = getWeek(week);
  openDialog(`
    <h3>Move “${dayTitle(wk.days[idx])}” to…</h3>
    <p class="muted"><small>The two nights swap, so nothing you bought for gets dropped.</small></p>
    <div class="card tight">
      ${wk.days.map((d, i) => i === idx ? '' : `
        <div class="row"><div class="grow"><b>${DAYS[fromIso(addDays(week, i)).getDay()]}</b><span class="sub">${dayTitle(d)}</span></div>
          <button class="btn small" data-action="swap-day" data-week="${week}" data-idx="${idx}" data-to="${i}">Swap</button></div>`).join('')}
    </div>
    <button class="btn block" data-action="close">Cancel</button>`);
}

function cookDialog(week, idx) {
  const d = getWeek(week).days[idx];
  const r = recipeById(d.recipeId);
  if (!r) return;
  const used = usesFresh(r);
  const radio = (name, value, label, checked) => `<label><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}>${label}</label>`;
  openDialog(`
    <form data-form="dialog">
      <h3>${esc(r.name)}</h3>
      <label>Would you make it again?</label>
      <div class="radio-row">${radio('rating', 'love', 'Yes, make again', r.rating === 'love')}${radio('rating', 'ok', 'It was fine', r.rating === 'ok' || !r.rating)}${radio('rating', 'no', 'Not again', r.rating === 'no')}</div>
      <label>Was ${d.servings} servings the right amount?</label>
      <div class="radio-row">${radio('amount', 'less', 'Too much', false)}${radio('amount', 'ok', 'Just right', true)}${radio('amount', 'more', 'Not enough', false)}</div>
      <label>Portions of leftovers saved</label>
      <input type="number" name="portions" min="0" max="20" value="0" inputmode="numeric">
      ${used.length ? `<label>Fresh food this used up</label>
        ${used.map((f) => `<div><label style="color:inherit;margin:4px 0"><input type="checkbox" name="used" value="${f.id}" checked> ${esc(f.name)}</label></div>`).join('')}` : ''}
      <div class="actions"><button class="btn primary">Save</button><button type="button" class="btn" data-action="close">Cancel</button></div>
    </form>`, (f) => {
    r.rating = f.get('rating') || r.rating;
    r.madeCount += 1;
    r.lastMade = today();
    const amount = f.get('amount');
    let msg = 'Saved.';
    if (amount === 'less' && d.servings > 1) { r.planServings = d.servings - 1; msg = `Next time this will be planned for ${r.planServings}.`; }
    if (amount === 'more') { r.planServings = d.servings + 1; msg = `Next time this will be planned for ${r.planServings}.`; }
    const portions = parseInt(f.get('portions'), 10) || 0;
    if (portions > 0) state.leftovers.push({ id: uid(), name: r.name, made: today(), portions, loc: locs()[0] });
    const usedIds = new Set(f.getAll('used'));
    state.fresh = state.fresh.filter((x) => !usedIds.has(x.id));
    d.cooked = true;
    toast(msg);
  });
}

function recipeDialog(id) {
  const r = recipeById(id);
  if (!r) return;
  openDialog(`
    <h3>${esc(r.name)}</h3>
    <p>${recipeMeta(r)}</p>
    <p class="muted"><small>Written for ${r.servings} servings · you plan it for ${plannedServings(r)}</small></p>
    <h2>Ingredients</h2>
    <div class="card tight">${r.ingredients.map((i) => `<div class="row"><div class="grow">${esc(ingredientLine(i))}</div><small class="muted">${i.cat}</small></div>`).join('') || '<p class="empty">None listed.</p>'}</div>
    ${r.steps ? `<h2>Method</h2><p class="pre">${esc(r.steps)}</p>` : ''}
    ${/^https?:\/\//i.test(r.source) ? `<p><a href="${esc(r.source)}" target="_blank" rel="noopener noreferrer">Original recipe</a></p>` : r.source ? `<p class="muted">${esc(r.source)}</p>` : ''}
    <div class="actions">
      <button class="btn" data-action="edit-recipe" data-id="${r.id}">Edit</button>
      <button class="btn danger" data-action="delete-recipe" data-id="${r.id}">Delete</button>
      <button class="btn primary" data-action="close">Close</button>
    </div>`);
}

function pasteRecipeDialog() {
  openDialog(`
    <h3>Paste a recipe</h3>
    <p class="muted"><small>Copy the recipe from a website, message or note and paste all of it here. You can check and fix it before saving.</small></p>
    <textarea id="paste-text" style="min-height:220px" placeholder="Paste the recipe text…"></textarea>
    <div class="actions"><button class="btn primary" id="paste-go">Read recipe</button><button class="btn" data-action="close">Cancel</button></div>`);
  $('#paste-go').onclick = () => {
    const text = $('#paste-text').value;
    if (!text.trim()) return toast('Paste the recipe text first.');
    const draft = parseRecipeText(text);
    recipeForm(null, draft);
    toast(draft.ingredients.length ? `Found ${draft.ingredients.length} ingredients. Check them over, then save.` : 'No ingredients found. Add them by hand.');
  };
}

function recipeForm(id, draft) {
  const r = id ? recipeById(id) : null;
  const v = r || draft;
  openDialog(`
    <form data-form="dialog">
      <h3>${r ? 'Edit recipe' : draft ? 'Check the recipe' : 'New recipe'}</h3>
      ${v ? '' : '<button type="button" class="btn block" data-action="paste-recipe" style="margin:0 0 6px">Paste a recipe instead of typing</button>'}
      <label>Name</label><input type="text" name="name" required value="${esc(v ? v.name : '')}">
      <label>Servings the recipe makes</label><input type="number" name="servings" min="1" max="40" required value="${v ? v.servings : state.settings.servings}">
      <label>Ingredients — one per line, amount first (e.g. “2 cups rice”)</label>
      <textarea name="ingredients">${esc(v ? v.ingredients.map(ingredientLine).join('\n') : '')}</textarea>
      <label>Method / notes</label><textarea name="steps">${esc(v ? v.steps : '')}</textarea>
      <label>Source (link or cookbook page)</label><input type="text" name="source" value="${esc(v ? v.source : '')}">
      <div class="actions"><button class="btn primary">Save</button><button type="button" class="btn" data-action="close">Cancel</button></div>
    </form>`, (f) => {
    const old = new Map((r ? r.ingredients : []).map((i) => [norm(i.name), i.cat]));
    const data = {
      name: f.get('name').trim(),
      servings: Math.max(1, parseInt(f.get('servings'), 10) || 1),
      ingredients: f.get('ingredients').split('\n').map((l) => l.trim()).filter(Boolean).map(parseIngredient)
        .map((i) => ({ ...i, cat: old.get(norm(i.name)) || i.cat })),
      steps: f.get('steps').trim(),
      source: f.get('source').trim(),
    };
    if (r) Object.assign(r, data);
    else state.recipes.push({ id: uid(), rating: null, madeCount: 0, lastMade: null, planServings: null, ...data });
  });
}

function settingsDialog() {
  openDialog(`
    <form data-form="dialog">
      <h3>Settings</h3>
      <label>People you usually cook for</label>
      <input type="number" name="servings" min="1" max="20" value="${state.settings.servings}">
      <label>Week starts on</label>
      <select name="weekStart">${DAYS.map((d, i) => `<option value="${i}" ${i === state.settings.weekStart ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <label>Places food is kept — one per line, in the order you check them</label>
      <textarea name="locations" style="min-height:90px">${esc(locs().join('\n'))}</textarea>
      <div class="actions"><button class="btn primary">Save</button><button type="button" class="btn" data-action="close">Cancel</button></div>
      <h2>Family sharing</h2>
      ${sync ? `
        <p class="muted"><small>This phone is sharing with your household. Send the invite link to each family member; opening it on their phone joins them.</small></p>
        <div class="actions">
          <button type="button" class="btn primary" data-action="sync-invite">Invite link</button>
          <button type="button" class="btn danger" data-action="sync-leave">Stop sharing on this phone</button>
        </div>` : `
        <p class="muted"><small>To share one set of data across phones, paste your Firebase database address (see the README) and start sharing from this phone. Everyone else joins with an invite link.</small></p>
        <input type="text" id="sync-url" placeholder="https://your-project-default-rtdb.firebaseio.com" autocomplete="off" autocapitalize="off">
        <div class="actions"><button type="button" class="btn primary" data-action="sync-create">Start sharing from this phone</button></div>`}
      <h2>Your data</h2>
      <p class="muted"><small>Export a backup file now and then to keep your recipes safe.</small></p>
      <div class="actions">
        <button type="button" class="btn" data-action="export">Export backup</button>
        <button type="button" class="btn" data-action="import">Import backup</button>
        <button type="button" class="btn danger" data-action="reset">Erase everything</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </form>`, (f) => {
    state.settings.servings = Math.max(1, parseInt(f.get('servings'), 10) || 4);
    state.settings.weekStart = parseInt(f.get('weekStart'), 10) || 0;
    const places = [...new Set(f.get('locations').split('\n').map((l) => l.trim()).filter(Boolean))];
    if (places.length) state.settings.locations = places;
    migrate();
    ui.week = weekStartOf(today());
  });
}

// ---------- actions ----------
function logWaste(name, kind) { state.wasteLog.push({ date: today(), name, kind }); }

const actions = {
  settings: () => settingsDialog(),
  close: () => closeDialog(),
  week: (el) => { ui.week = addDays(ui.week, Number(el.dataset.n)); render(); },

  'pick-day': (el) => pickDayDialog(el.dataset.week, Number(el.dataset.idx)),
  'move-day': (el) => moveDayDialog(el.dataset.week, Number(el.dataset.idx)),
  'set-slot': (el) => {
    getWeek(el.dataset.week).days[Number(el.dataset.idx)] = el.dataset.type ? { type: el.dataset.type } : null;
    closeDialog(); commit();
  },
  'set-recipe': (el) => {
    const r = recipeById(el.dataset.id);
    getWeek(el.dataset.week).days[Number(el.dataset.idx)] = { type: 'recipe', recipeId: r.id, servings: plannedServings(r), cooked: false };
    closeDialog(); commit();
  },
  'swap-day': (el) => {
    const days = getWeek(el.dataset.week).days;
    const a = Number(el.dataset.idx), b = Number(el.dataset.to);
    [days[a], days[b]] = [days[b], days[a]];
    closeDialog(); commit();
  },
  servings: (el) => {
    const d = getWeek(el.dataset.week).days[Number(el.dataset.idx)];
    openDialog(`
      <form data-form="dialog"><h3>How many servings?</h3>
        <input type="number" name="servings" min="1" max="40" value="${d.servings}" inputmode="numeric">
        <p class="muted"><small>The shopping list scales to match. Cook extra on purpose only if you’ve planned a leftovers night.</small></p>
        <div class="actions"><button class="btn primary">Save</button><button type="button" class="btn" data-action="close">Cancel</button></div>
      </form>`, (f) => { d.servings = Math.max(1, parseInt(f.get('servings'), 10) || d.servings); });
  },
  cook: (el) => cookDialog(el.dataset.week, Number(el.dataset.idx)),

  'build-list': () => {
    buildList();
    ui.tab = 'list';
    commit();
    const have = state.list.filter((i) => i.status === 'have').length;
    toast(have ? `List built. ${have} item${have === 1 ? '' : 's'} you already have were left off.` : 'List built.');
  },
  'toggle-bought': (el) => { const i = state.list.find((x) => x.id === el.dataset.id); i.status = i.status === 'bought' ? 'need' : 'bought'; commit(); },
  have: (el) => { const i = state.list.find((x) => x.id === el.dataset.id); i.status = 'have'; i.hint = ''; commit(); },
  need: (el) => { state.list.find((x) => x.id === el.dataset.id).status = 'need'; commit(); },
  'finish-shop': () => { const n = finishShopping(); commit(); toast(`${n} item${n === 1 ? '' : 's'} put away. Fresh food was added to Kitchen.`); },
  'share-list': async () => {
    const text = listAsText();
    if (!text) return toast('Nothing to share yet.');
    try {
      if (navigator.share) await navigator.share({ title: 'Shopping list', text });
      else { await navigator.clipboard.writeText(text); toast('List copied.'); }
    } catch (e) { /* share sheet dismissed */ }
  },

  'recipe-filter': (el) => { ui.recipeFilter = el.dataset.id; render(); },
  'new-recipe': () => recipeForm(null),
  'paste-recipe': () => pasteRecipeDialog(),
  'quick-add': (el) => { addListItem(el.dataset.name); commit(); },
  'view-recipe': (el) => recipeDialog(el.dataset.id),
  'edit-recipe': (el) => recipeForm(el.dataset.id),
  'delete-recipe': (el) => {
    const r = recipeById(el.dataset.id);
    if (!confirm(`Delete “${r.name}”?`)) return;
    state.recipes = state.recipes.filter((x) => x.id !== r.id);
    for (const wk of Object.values(state.weeks)) wk.days = wk.days.map((d) => (d && d.recipeId === r.id ? null : d));
    closeDialog(); commit();
  },

  'left-done': (el) => { state.leftovers = state.leftovers.filter((x) => x.id !== el.dataset.id); commit(); },
  'left-toss': (el) => { const l = state.leftovers.find((x) => x.id === el.dataset.id); logWaste(l.name, 'leftovers'); state.leftovers = state.leftovers.filter((x) => x !== l); commit(); },
  'fresh-done': (el) => { state.fresh = state.fresh.filter((x) => x.id !== el.dataset.id); commit(); },
  'fresh-toss': (el) => { const f = state.fresh.find((x) => x.id === el.dataset.id); logWaste(f.name, 'fresh'); state.fresh = state.fresh.filter((x) => x !== f); commit(); },
  'staple-count': (el) => { const s = state.staples.find((x) => x.id === el.dataset.id); s.have = Math.max(0, s.have + Number(el.dataset.n)); commit(); },
  'staple-open': (el) => {
    const s = state.staples.find((x) => x.id === el.dataset.id);
    openDialog(`
      <form data-form="dialog">
        <h3>Staple</h3>
        <label>Name</label><input type="text" name="name" required value="${esc(s.name)}">
        <label>Safety stock — how many to always keep on hand</label>
        <input type="number" name="target" min="1" max="99" value="${s.target}" inputmode="numeric">
        <label>Kept in</label>
        <select name="loc">${locs().map((l) => `<option ${l === s.loc ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <p class="muted"><small>When the count drops below this number, the shopping list adds enough to get back to it.</small></p>
        <div class="actions"><button class="btn primary">Save</button>
          <button type="button" class="btn danger" data-action="staple-del" data-id="${s.id}">Remove</button>
          <button type="button" class="btn" data-action="close">Cancel</button></div>
      </form>`, (f) => {
      s.name = f.get('name').trim() || s.name;
      s.cat = guessCat(s.name);
      s.target = Math.max(1, parseInt(f.get('target'), 10) || 1);
      s.loc = f.get('loc');
    });
  },
  'staple-del': (el) => { state.staples = state.staples.filter((x) => x.id !== el.dataset.id); closeDialog(); commit(); },
  'loc-check': (el) => { const wk = getWeek(ui.week); wk.checked[el.dataset.loc] = !wk.checked[el.dataset.loc]; commit(); },
  'item-move': (el) => {
    const x = [...state.fresh, ...state.leftovers].find((i) => i.id === el.dataset.id);
    openDialog(`
      <h3>Where is “${esc(x.name)}”?</h3>
      <div class="chips">${locs().map((l) => `<button class="chip ${l === x.loc ? 'on' : ''}" data-action="set-loc" data-id="${x.id}" data-loc="${esc(l)}">${esc(l)}</button>`).join('')}</div>
      <button class="btn block" data-action="close">Cancel</button>`);
  },
  'set-loc': (el) => {
    [...state.fresh, ...state.leftovers].find((i) => i.id === el.dataset.id).loc = el.dataset.loc;
    closeDialog(); commit();
  },

  export: () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `food-manager-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  import: () => $('#import-file').click(),
  'sync-create': () => {
    const url = $('#sync-url').value.trim();
    if (!/^https?:\/\/\S+$/.test(url)) return toast('Paste the database address first. It starts with https://');
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    connectSync(url, Array.from(bytes, (b) => alphabet[b % alphabet.length]).join(''));
    closeDialog();
    toast('Sharing started. Open Settings to get the invite link.');
  },
  'sync-invite': async () => {
    const link = inviteLink();
    openDialog(`
      <h3>Invite link</h3>
      <p class="muted"><small>Send this to family members only. Anyone who has it can see and change your household’s food data.</small></p>
      <input type="text" readonly value="${esc(link)}" onfocus="this.select()">
      <div class="actions"><button class="btn primary" id="invite-send">Share / copy</button><button class="btn" data-action="close">Close</button></div>`);
    $('#invite-send').onclick = async () => {
      try {
        if (navigator.share) await navigator.share({ title: 'Join our Food Manager', url: link });
        else { await navigator.clipboard.writeText(link); toast('Link copied.'); }
      } catch (e) { /* dismissed */ }
    };
  },
  'sync-leave': () => {
    if (!confirm('Stop sharing on this phone? The data stays here, but it will no longer update.')) return;
    sync = null; saveSync(); startSync(); closeDialog();
  },
  reset: () => {
    if (!confirm(sync ? 'Erase all recipes, menus and lists for EVERYONE in your household?' : 'Erase all recipes, menus and lists on this device?')) return;
    state = defaults();
    migrate();
    ui.week = weekStartOf(today());
    closeDialog(); commit();
  },
};

const forms = {
  'add-item': (f) => splitItems(f.get('name')).forEach(addListItem),
  'add-loc-item': (f) => splitItems(f.get('name')).forEach((name) => addLocItem(name, f.get('loc'), f.get('kind'))),
};

// Add a hand-typed item to the shopping list and remember it for one-tap repeats.
function addListItem(text) {
  const p = parseIngredient(text);
  if (!p.name) return;
  state.list.push({ id: uid(), source: 'manual', key: `manual|${uid()}`, status: 'need', for: [], ...p });
  const k = norm(p.name);
  state.freq[k] = { name: p.name, n: ((state.freq[k] || {}).n || 0) + 1 };
}
// The items typed most often that are not already on the list.
function frequentItems() {
  const onList = new Set(state.list.map((i) => norm(i.name)));
  return Object.entries(state.freq).filter(([k]) => !onList.has(k)).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([, v]) => v.name);
}

const addLocItem = (name, loc, kind) => {
  {
    if (kind === 'staple') state.staples.push({ id: uid(), name, cat: guessCat(name), target: 1, have: 1, loc });
    else if (kind === 'left') state.leftovers.push({ id: uid(), name, made: today(), portions: 0, loc });
    else state.fresh.push({ id: uid(), name, added: today(), loc, kind });
  }
};

// ---------- events ----------
document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { ui.tab = tabBtn.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const data = new FormData(form);
  if (form.dataset.form === 'dialog') {
    if (onDialogSubmit) onDialogSubmit(data);
    closeDialog();
  } else {
    forms[form.dataset.form](data);
  }
  commit();
});

// Pasting a multi-line list into an add box: keep the lines apart so each becomes its own item.
document.addEventListener('paste', (e) => {
  const input = e.target.closest('[data-form="add-item"] input[name=name], [data-form="add-loc-item"] input[name=name]');
  const text = input && e.clipboardData ? e.clipboardData.getData('text') : '';
  if (!/\n/.test(text)) return;
  e.preventDefault();
  input.value = [input.value.trim(), ...splitItems(text)].filter(Boolean).join(', ');
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'recipe-q') { ui.q = e.target.value; $('#recipe-list').innerHTML = recipeListHtml(); }
});

document.addEventListener('change', (e) => {
  if (e.target.id !== 'import-file' || !e.target.files[0]) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.recipes) || !data.settings) throw new Error('bad file');
      state = Object.assign(defaults(), data);
      migrate();
      ui.week = weekStartOf(today());
      closeDialog(); commit(); toast('Backup imported.');
    } catch (err) { toast('That file is not a Food Manager backup.'); }
  };
  reader.readAsText(e.target.files[0]);
});

// ---------- family sharing (Firebase Realtime Database over its REST API) ----------
// Each top-level section of the state is stored as one string, "<clientId>\n<json>", under
// /households/<code>. Strings round-trip exactly, and syncing per section means two people
// editing different things (say, the list and a recipe) never overwrite each other.
const SYNC_KEY = 'foodmanager.sync';
const SECTIONS = ['settings', 'recipes', 'weeks', 'list', 'fresh', 'leftovers', 'staples', 'wasteLog', 'freq'];
let sync = null;            // { url, code, client, dirty: [sections changed here but not yet uploaded] }
const pushed = {};          // section -> JSON last known to match the server
let stream = null, syncReady = false, flushing = false;
const pendingRemote = [];

function loadSync() {
  try { sync = JSON.parse(localStorage.getItem(SYNC_KEY)); } catch (e) { sync = null; }
  for (const k of SECTIONS) pushed[k] = JSON.stringify(state[k]);
}
function saveSync() {
  if (sync) localStorage.setItem(SYNC_KEY, JSON.stringify(sync));
  else localStorage.removeItem(SYNC_KEY);
}
const syncEndpoint = () => `${sync.url}/households/${sync.code}.json`;

function setSyncState(s) {
  const el = $('#sync-status');
  el.textContent = { off: '', connecting: 'Connecting…', ok: 'Shared', offline: 'Offline' }[s];
  el.className = `sync ${s}`;
  el.dataset.state = s;
}

function startSync() {
  if (stream) { stream.close(); stream = null; }
  syncReady = false;
  if (!sync) return setSyncState('off');
  setSyncState('connecting');
  stream = new EventSource(syncEndpoint());
  const on = (e) => {
    const msg = { type: e.type, ...JSON.parse(e.data) };
    if (dialog().open) pendingRemote.push(msg); else applyRemote(msg);
  };
  stream.addEventListener('put', on);
  stream.addEventListener('patch', on);
  stream.addEventListener('cancel', () => { setSyncState('offline'); toast('The database refused access. Check its rules.'); });
  stream.onerror = () => setSyncState('offline');   // EventSource reconnects by itself
}

function applyRemote({ type, path, data }) {
  if (!sync) return;
  const whole = path === '/';
  const incoming = whole ? (data || {}) : { [path.split('/')[1]]: data };
  let changed = false;
  for (const k of SECTIONS) {
    const v = incoming[k];
    if (typeof v !== 'string') {
      // A full snapshot without this section: the household doesn't have it yet, so upload ours.
      if (whole && type === 'put' && !sync.dirty.includes(k)) sync.dirty.push(k);
      continue;
    }
    const nl = v.indexOf('\n');
    const by = v.slice(0, nl), json = v.slice(nl + 1);
    if (by === sync.client) continue;   // our own echo
    if (sync.dirty.includes(k)) {
      // Both sides changed this section (usually after being offline): combine them, then upload.
      try { state[k] = merge3(pushed[k], state[k], JSON.parse(json)); changed = true; } catch (e) { /* keep ours */ }
      pushed[k] = json;
      continue;
    }
    pushed[k] = json;
    if (json !== JSON.stringify(state[k])) {
      try { state[k] = JSON.parse(json); changed = true; } catch (e) { /* ignore a corrupt section */ }
    }
  }
  syncReady = true;
  setSyncState('ok');
  if (changed) {
    migrate();
    localStorage.setItem(KEY, JSON.stringify(state));
    ui.week = weekStartOf(ui.week);
    render();
  }
  saveSync();
  flush();
}

// Three-way merge of one section, item by item: whichever side changed an item since the last
// sync wins, and a change made on this phone wins if both did.
function merge3(baseJson, local, remote) {
  const isArr = Array.isArray(remote);
  const keyOf = (x) => (x && x.id) || JSON.stringify(x);
  const toMap = (v) => new Map(isArr ? (v || []).map((x) => [keyOf(x), x]) : Object.entries(v || {}));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const B = toMap(JSON.parse(baseJson)), L = toMap(local), R = toMap(remote);
  const out = new Map();
  for (const [k, v] of R) {
    if (same(L.get(k), B.get(k))) out.set(k, v);          // untouched here: take theirs
    else if (L.has(k)) out.set(k, L.get(k));              // edited here (deleted here: drop)
  }
  for (const [k, v] of L) {
    if (!R.has(k) && !same(v, B.get(k))) out.set(k, v);   // added or edited here
  }
  return isArr ? [...out.values()] : Object.fromEntries(out);
}

async function flush() {
  if (!sync || !syncReady || flushing || !sync.dirty.length) return;
  flushing = true;
  const target = sync, keys = [...sync.dirty], body = {}, sent = {};
  for (const k of keys) { sent[k] = JSON.stringify(state[k]); body[k] = `${sync.client}\n${sent[k]}`; }
  let ok = false;
  try {
    const res = await fetch(syncEndpoint(), { method: 'PATCH', body: JSON.stringify(body) });
    ok = res.ok;
  } catch (e) { /* offline */ }
  flushing = false;
  if (sync !== target) return;
  if (!ok) return setSyncState('offline');
  for (const k of keys) {
    pushed[k] = sent[k];
    if (JSON.stringify(state[k]) === sent[k]) sync.dirty = sync.dirty.filter((x) => x !== k);
  }
  saveSync();
  setSyncState('ok');
  if (sync.dirty.length) flush();
}

function connectSync(url, code) {
  sync = { url: url.replace(/\/+$/, ''), code, client: uid(), dirty: [] };
  for (const k of SECTIONS) pushed[k] = JSON.stringify(state[k]);
  saveSync();
  startSync();
}

function inviteLink() {
  const token = btoa(JSON.stringify({ u: sync.url, c: sync.code }));
  return `${location.origin}${location.pathname}#join=${encodeURIComponent(token)}`;
}

function checkInvite() {
  const m = location.hash.match(/^#join=(.+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  let inv;
  try { inv = JSON.parse(atob(decodeURIComponent(m[1]))); } catch (e) { return toast('That invite link is not valid.'); }
  if (!inv || !/^https?:\/\//.test(inv.u) || !/^[A-Za-z0-9]{20,}$/.test(inv.c)) return toast('That invite link is not valid.');
  if (sync && sync.url === inv.u && sync.code === inv.c) return;
  openDialog(`
    <h3>Join your household?</h3>
    <p>This phone will share one set of recipes, menus and lists with everyone else who joined.</p>
    <p class="muted"><small>Anything saved in the app on this phone so far will be replaced by the household’s data.</small></p>
    <div class="actions"><button class="btn primary" id="join-yes">Join</button><button class="btn" data-action="close">Not now</button></div>`);
  $('#join-yes').onclick = () => { closeDialog(); connectSync(inv.u, inv.c); toast('Joined. Loading the household’s data…'); };
}

window.addEventListener('online', flush);
window.addEventListener('hashchange', checkInvite);
setInterval(flush, 20000);

// ---------- start ----------
load();
loadSync();
ui.week = weekStartOf(today());
render();
dialog().addEventListener('close', () => { while (pendingRemote.length) applyRemote(pendingRemote.shift()); });
startSync();
checkInvite();
