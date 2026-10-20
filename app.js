// ===== CONFIGURACIÓN =====
// Datos de la tienda: los inserta scripts/build.mjs desde tienda.config.json y data/ajustes.json
const TIENDA = %%TIENDA_JSON%%;

// WhatsApp en formato internacional, solo dígitos (Chile: 56 + 9 + 8 dígitos)
const WHATSAPP_NUMBER = TIENDA.whatsapp;

// ADAPTAR: días mínimos de anticipación según tipo de entrega
const LEAD_DAYS = { retiro: 1, domicilio: 2, region: 3 };

const ENTREGAS = {
  retiro: `Retiro en ${TIENDA.ciudad}`,
  domicilio: 'Despacho a domicilio',
  region: 'Envío a región',
};

// Productos y categorías se editan desde el panel /admin (data/productos, data/categorias)
// y se publican juntos en data/catalogo.json (lo genera scripts/build.mjs)
let PRODUCTS = [];
let FILTERS = [['todos', 'Todos']];

const SORTS = {
  destacados: null,
  'precio-asc': (a, b) => a.price - b.price,
  'precio-desc': (a, b) => b.price - a.price,
};

// Qué se puede grabar. Cada producto define cuáles permite y cuántos como máximo (en /admin).
// Los de texto piden su propio campo; los de "archivo" (logo, imagen) se adjuntan por WhatsApp.
const GRABADOS = [
  { id: 'nombre', label: 'Nombre', icon: 'i-type', ej: 'Ej: Camila', max: 40, el: 'el nombre' },
  { id: 'iniciales', label: 'Iniciales', icon: 'i-hash', ej: 'Ej: C & M', max: 12, el: 'las iniciales' },
  { id: 'fecha', label: 'Fecha', icon: 'i-calendar', ej: 'Ej: 14/02/2026', max: 30, el: 'la fecha' },
  { id: 'frase', label: 'Frase', icon: 'i-quote', ej: 'Ej: Siempre juntos', max: 80, el: 'la frase' },
  { id: 'logo', label: 'Logo o escudo', icon: 'i-shield', archivo: true },
  { id: 'imagen', label: 'Imagen o dibujo', icon: 'i-image', archivo: true },
];

const CART_KEY = 'obsesionMateCarrito';

// ===== UTILIDADES =====
const clp = (n) => '$' + n.toLocaleString('es-CL');
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = (id) => `<svg class="ic"><use href="#${id}"/></svg>`;
const findProduct = (id) => PRODUCTS.find((p) => p.id === id);
const clampQty = (n) => Math.min(500, Math.max(1, parseInt(n, 10) || 1));
// Se usa api.whatsapp.com y no wa.me: la redirección de wa.me rompe los emojis (llegan como �)
const waUrl = (text) =>
  `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}${text ? '&text=' + encodeURIComponent(text) : ''}`;

function isoPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().split('T')[0];
}

function nextOrderNumber() {
  // Correlativo guardado en este navegador (empieza en 0142)
  let n = 141;
  try { n = parseInt(localStorage.getItem('orderCounter') || '141', 10) || 141; } catch (e) {}
  return String(n + 1).padStart(4, '0');
}
function commitOrderNumber(num) {
  try { localStorage.setItem('orderCounter', String(parseInt(num, 10))); } catch (e) {}
}

// Ventanas (ficha, carrito, visor): bloquea el scroll de la página mientras haya alguna abierta
function setOpen(el, open) {
  el.classList.toggle('is-open', open);
  el.setAttribute('aria-hidden', String(!open));
  document.body.style.overflow = $$('.sheet.is-open, .drawer.is-open, .viewer.is-open').length ? 'hidden' : '';
}

let toastTimer;
function toast(html) {
  const el = $('#toast');
  el.innerHTML = html;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 3200);
}

// ===== CATÁLOGO =====
const grid = $('#productGrid');
const filters = $('#filters');

function renderFilters(active) {
  const count = (k) => (k === 'todos' ? PRODUCTS.length : PRODUCTS.filter((p) => p.tags.includes(k)).length);
  filters.innerHTML = FILTERS
    .filter(([k]) => count(k) > 0) // oculta categorías vacías
    .map(([k, label]) => `<button class="tab ${k === active ? 'is-active' : ''}" role="tab" aria-selected="${k === active}" data-cat="${esc(k)}">${esc(label)}<span class="tab__n">${count(k)}</span></button>`)
    .join('');
}

let currentCat = 'todos';

// misma tarjeta que card() en scripts/build.mjs
const cardHtml = (p) => `
    <article class="card${p.agotado ? ' is-soldout' : ''}">
      <button type="button" class="card__img" data-product="${esc(p.id)}" aria-label="Ver ${esc(p.name)}">
        ${p.agotado ? '<span class="badge badge--soldout">Agotado</span>' : p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}
        <img class="card__blur" src="${esc(p.img)}" alt="" aria-hidden="true" loading="lazy">
        <img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy">
        ${p.gallery.length > 1 ? `<span class="card__photos">${icon('i-image')} ${p.gallery.length}</span>` : ''}
      </button>
      <div class="card__body">
        ${p.category ? `<p class="card__cat">${esc(p.category)}</p>` : ''}
        <h3><button type="button" data-product="${esc(p.id)}">${esc(p.name)}</button></h3>
        ${p.desc ? `<p class="card__desc">${esc(p.desc)}</p>` : ''}
        ${p.items.length ? `<ul class="card__list">${p.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
        ${p.grabado || p.mayor ? `<p class="card__chips">${p.grabado ? `<span class="chip${p.grabado === 'incluido' ? ' chip--gold' : ''}">${icon('i-sparkles')} Grabado ${p.grabado}</span>` : ''}${p.mayor ? `<span class="chip chip--mayor">${icon('i-users')} Por mayor ${clp(p.mayor.precio)} · desde ${p.mayor.desde}</span>` : ''}</p>` : ''}
        <div class="card__foot">
          <div class="card__price">
            <span class="price">${clp(p.price)}</span>
          </div>
          ${p.agotado
            ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(waUrl(`Hola! ¿Tienen stock de ${p.name}? 🧉`))}">Consultar stock</a>`
            : `<button class="btn btn--primary btn--sm btn--add" data-product="${esc(p.id)}">${icon('i-bag')} Agregar</button>`}
        </div>
      </div>
    </article>`;

function renderProducts(cat = currentCat) {
  currentCat = cat;
  let list = cat === 'todos' ? PRODUCTS : PRODUCTS.filter((p) => p.tags.includes(cat));
  const sort = SORTS[$('#sort').value];
  if (sort) list = [...list].sort(sort);
  $('#count').innerHTML = `Mostrando <strong>${list.length}</strong> ${list.length === 1 ? 'producto' : 'productos'}`;
  grid.innerHTML = list.map(cardHtml).join('');
}

filters.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  renderFilters(btn.dataset.cat);
  renderProducts(btn.dataset.cat);
});
$('#sort').addEventListener('change', () => renderProducts());

// ===== CARRITO (se guarda en este navegador) =====
// Cada línea: { key, id, qty, opcion, nota, grabado: { tipos: [], textos: { nombre: '…' } } | null }
let cart = [];
try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (e) {}
if (!Array.isArray(cart)) cart = [];

function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
}

// El precio por mayor se calcula con el total de unidades del mismo producto (aunque tengan grabados distintos)
const qtyOf = (id) => cart.filter((l) => l.id === id).reduce((s, l) => s + l.qty, 0);
const unitPrice = (p, qty) => (p.mayor && qty >= p.mayor.desde ? p.mayor.precio : p.price);

function totals() {
  let total = 0, normal = 0, count = 0, cotizar = false;
  cart.forEach((l) => {
    const p = findProduct(l.id);
    total += unitPrice(p, qtyOf(l.id)) * l.qty;
    normal += p.price * l.qty;
    count += l.qty;
    if (l.grabado && p.grabado === 'opcional') cotizar = true;
  });
  return { total, ahorro: normal - total, count, cotizar };
}

const tipoDe = (id) => GRABADOS.find((g) => g.id === id) || { id, label: id };
const esArchivo = (id) => !!tipoDe(id).archivo;
// "Nombre: “Camila” · Logo o escudo (por WhatsApp)"
const grabadoPartes = (g) => g.tipos.map((t) =>
  esArchivo(t) ? `${tipoDe(t).label} (por WhatsApp)` : `${tipoDe(t).label}: “${(g.textos || {})[t] || ''}”`);
const grabadoResumen = (g) => grabadoPartes(g).join(' · ');

function renderCart() {
  const t = totals();
  $$('[data-cart-count]').forEach((el) => { el.textContent = t.count; });
  $('.cart-btn').classList.toggle('has-items', t.count > 0);
  $('#cartBar').hidden = t.count === 0;
  $('#cartBarTotal').textContent = clp(t.total);

  $('#cartEmpty').hidden = cart.length > 0;
  $('#cartLines').innerHTML = cart.map((l) => {
    const p = findProduct(l.id);
    const unit = unitPrice(p, qtyOf(l.id));
    return `
      <li class="line">
        <img src="${esc(p.img)}" alt="">
        <div class="line__info">
          <strong>${esc(p.name)}</strong>
          ${l.opcion ? `<small>${esc(p.opcionesTitulo || 'Opción')}: ${esc(l.opcion)}</small>` : ''}
          ${l.grabado ? `<small class="line__engrave">${icon('i-sparkles')} ${esc(grabadoResumen(l.grabado))}</small>` : ''}
          ${l.nota ? `<small>Nota: ${esc(l.nota)}</small>` : ''}
          <div class="line__row">
            <div class="qty qty--sm">
              <button type="button" data-line-qty="-1" data-key="${esc(l.key)}" aria-label="Quitar uno">−</button>
              <span>${l.qty}</span>
              <button type="button" data-line-qty="1" data-key="${esc(l.key)}" aria-label="Agregar uno">+</button>
            </div>
            <span class="line__price">${clp(unit * l.qty)}${unit !== p.price ? `<small>${clp(unit)} c/u por mayor</small>` : ''}</span>
          </div>
        </div>
        <button type="button" class="line__remove" data-remove="${esc(l.key)}" aria-label="Quitar ${esc(p.name)}">${icon('i-trash')}</button>
      </li>`;
  }).join('');

  const rows = [];
  if (t.ahorro > 0) rows.push(`<div class="sum__save"><dt>Ahorro por mayor</dt><dd>−${clp(t.ahorro)}</dd></div>`);
  rows.push(`<div><dt>Envío</dt><dd>A coordinar</dd></div>`);
  if (t.cotizar) rows.push(`<div><dt>Grabado opcional</dt><dd>A cotizar</dd></div>`);
  rows.push(`<div class="sum__total"><dt>Total</dt><dd>${cart.length ? clp(t.total) : 'A cotizar'}</dd></div>`);
  $('#cartSum').innerHTML = rows.join('');
  $('#cartNext').disabled = cart.length === 0;
  if ($('#cart').classList.contains('is-open')) updatePreview();
}

function addToCart(line) {
  const same = cart.find((l) => l.key === line.key);
  if (same) same.qty = clampQty(same.qty + line.qty);
  else cart.push(line);
  saveCart();
  renderCart();
}

$('#cartLines').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    cart = cart.filter((l) => l.key !== rm.dataset.remove);
  } else {
    const b = e.target.closest('[data-line-qty]');
    if (!b) return;
    const l = cart.find((x) => x.key === b.dataset.key);
    if (!l) return;
    l.qty += Number(b.dataset.lineQty);
    if (l.qty < 1) cart = cart.filter((x) => x !== l);
    else l.qty = clampQty(l.qty);
  }
  saveCart();
  renderCart();
});

// ===== FICHA DE PRODUCTO =====
const sheet = $('#sheet');
const sheetForm = $('#sheetForm');
let current = null;

let campos = {}; // lo escrito en cada campo de grabado, para no perderlo al marcar/desmarcar

function setPhoto(i) {
  $('#sheetImg').src = current.gallery[i];
  $('#sheetImg').alt = current.name;
  $('#sheetZoom').dataset.idx = i;
  $$('#sheetThumbs button').forEach((b, j) => b.classList.toggle('is-active', i === j));
}

function openSheet(id) {
  const p = findProduct(id);
  if (!p) return;
  current = p;
  sheetForm.reset();
  $('#sheetError').hidden = true;
  $('#sheetCat').textContent = p.category;
  $('#sheetTitle').textContent = p.name;
  $('#sheetPrice').innerHTML = `<span class="price">${clp(p.price)}</span>${p.mayor ? `<span class="chip chip--gold">Por mayor ${clp(p.mayor.precio)} c/u desde ${p.mayor.desde}</span>` : ''}`;
  $('#sheetDesc').textContent = p.desc;
  $('#sheetDesc').hidden = !p.desc;
  $('#sheetList').innerHTML = p.items.map((i) => `<li>${esc(i)}</li>`).join('');
  $('#sheetThumbs').innerHTML = p.gallery.length > 1
    ? p.gallery.map((src, i) => `<button type="button" data-thumb="${i}" aria-label="Foto ${i + 1}"><img src="${esc(src)}" alt=""></button>`).join('')
    : '';
  setPhoto(0);

  // Opciones (virola, modelo…): la primera queda elegida
  const opts = $('#sheetOpts');
  opts.hidden = !p.opciones.length;
  opts.innerHTML = p.opciones.length
    ? `<legend>${esc(p.opcionesTitulo || 'Elige una opción')}</legend><div class="radios">${p.opciones
        .map((o, i) => `<label class="radio"><input type="radio" name="opcion" value="${esc(o)}"${i ? '' : ' checked'}><span>${esc(o)}</span></label>`)
        .join('')}</div>`
    : '';

  // Grabado: incluido viene activado; opcional se activa si el cliente lo quiere
  const box = $('#sheetEngrave');
  box.hidden = !p.grabado;
  box.classList.toggle('is-included', p.grabado === 'incluido');
  $('#sGrabar').checked = p.grabado === 'incluido';
  $('#sGrabadoInfo').textContent = [p.grabado === 'incluido' ? 'Incluido en el precio' : 'Opcional · se cotiza aparte', p.grabadoDetalle]
    .filter(Boolean).join(' · ');
  // Solo los tipos que permite este producto (ej: un termo no lleva fecha ni iniciales)
  $('#sTipos').innerHTML = GRABADOS.filter((g) => !p.grabadoTipos.length || p.grabadoTipos.includes(g.id))
    .map((g) => `<label><input type="checkbox" value="${g.id}"><span>${icon(g.icon)}${esc(g.label)}</span></label>`)
    .join('');
  campos = {};
  renderCampos();
  syncSheet();
  setOpen(sheet, true);
}

function sheetTipos() {
  return $$('#sTipos input:checked').map((i) => i.value);
}

// Un campo por cada cosa de texto elegida (Nombre, Fecha, Frase…), en el orden de los chips
function renderCampos() {
  $$('#sCampos input').forEach((i) => { campos[i.dataset.campo] = i.value; });
  $('#sCampos').innerHTML = sheetTipos().filter((t) => !esArchivo(t)).map((t) => {
    const g = tipoDe(t);
    return `<label>${icon(g.icon)} ${esc(g.label)}
      <input type="text" data-campo="${g.id}" maxlength="${g.max}" placeholder="${esc(g.ej)}" value="${esc(campos[g.id] || '')}">
    </label>`;
  }).join('');
}

// Respeta el máximo del producto: al llegar al tope se bloquean los demás chips
function syncTipos() {
  const max = current.grabadoMax;
  const n = sheetTipos().length;
  $$('#sTipos input').forEach((i) => {
    i.disabled = !!max && n >= max && !i.checked;
    i.closest('label').classList.toggle('is-locked', i.disabled);
  });
  $('#sTiposHint').textContent = max
    ? `Elige hasta ${max} · ${n} de ${max}`
    : 'Puedes elegir varias';
}

function syncSheet() {
  if (!current) return;
  const grabar = !!current.grabado && $('#sGrabar').checked;
  $('#sGrabadoBody').classList.toggle('is-open', grabar);
  $('#sheetEngrave').classList.toggle('is-on', grabar);
  syncTipos();
  $('#sArchivo').hidden = !sheetTipos().some(esArchivo);

  const qty = clampQty($('#sQty').value);
  const total = qty + qtyOf(current.id);
  const unit = unitPrice(current, total);
  $('#sAddLabel').textContent = `Agregar · ${clp(unit * qty)}`;

  // Medidor de precio por mayor (cuenta lo que ya está en el carrito)
  const meter = $('#sMayor');
  meter.hidden = !current.mayor;
  if (current.mayor) {
    const falta = current.mayor.desde - total;
    const pct = Math.min(100, (total / current.mayor.desde) * 100);
    meter.classList.toggle('is-done', falta <= 0);
    meter.innerHTML = `<p>${falta > 0
      ? `Agrega <strong>${falta} más</strong> y pagas <strong>${clp(current.mayor.precio)}</strong> c/u (precio por mayor)`
      : `${icon('i-check')} <strong>Precio por mayor aplicado:</strong> ${clp(current.mayor.precio)} c/u`}</p>
      <span class="mayor-meter__bar"><span style="width:${pct}%"></span></span>`;
  }
}

sheetForm.addEventListener('input', () => { $('#sheetError').hidden = true; syncSheet(); });
sheetForm.addEventListener('change', (e) => {
  if (e.target.closest('#sTipos')) renderCampos();
  syncSheet();
});
$('#sheetThumbs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-thumb]');
  if (b) setPhoto(Number(b.dataset.thumb));
});
$('#sheetZoom').addEventListener('click', () => openViewer(current, Number($('#sheetZoom').dataset.idx) || 0));
sheetForm.addEventListener('click', (e) => {
  const b = e.target.closest('[data-qty]');
  if (!b) return;
  $('#sQty').value = clampQty(clampQty($('#sQty').value) + Number(b.dataset.qty));
  syncSheet();
});

sheetForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const p = current;
  const err = $('#sheetError');
  let grabado = null;
  if (p.grabado && $('#sGrabar').checked) {
    const tipos = sheetTipos();
    if (!tipos.length) { err.textContent = 'Elige qué quieres grabar (o desactiva el grabado).'; err.hidden = false; return; }
    const textos = {};
    const vacio = $$('#sCampos input').find((i) => !(textos[i.dataset.campo] = i.value.trim()));
    if (vacio) {
      err.textContent = `Escribe ${tipoDe(vacio.dataset.campo).el} que quieres grabar.`;
      err.hidden = false;
      vacio.focus();
      return;
    }
    grabado = { tipos, textos };
  }
  const opcion = (sheetForm.querySelector('input[name="opcion"]:checked') || {}).value || '';
  const nota = $('#sNota').value.trim();
  const qty = clampQty($('#sQty').value);
  const key = JSON.stringify([p.id, opcion, nota, grabado]);
  addToCart({ key, id: p.id, qty, opcion, nota, grabado });
  setOpen(sheet, false);
  toast(`${icon('i-check')}<span><strong>${esc(p.name)}</strong> agregado al carrito</span><button type="button" data-open-cart>Ver carrito</button>`);
});

// ===== CHECKOUT (paso 2 del carrito) =====
const checkout = $('#checkoutForm');
const fFecha = $('#fFecha');
const fPago = $('#fPago');
let orderNumber = nextOrderNumber();

function openCart(step = 1) {
  renderCart();
  goStep(step);
  setOpen($('#cart'), true);
}

function goStep(step) {
  const two = step === 2;
  $('#cartStep1').hidden = two;
  checkout.hidden = !two;
  $('#cartBack').hidden = !two;
  $('#cartNext').hidden = two;
  $('#cartSend').hidden = !two;
  $('#cartTitle').textContent = two ? (cart.length ? 'Entrega y datos' : 'Pide una cotización') : 'Tu carrito';
  $$('[data-step-dot]').forEach((d) => d.classList.toggle('is-active', Number(d.dataset.stepDot) <= step));
  $('#formError').hidden = true;
  if (two) { syncDelivery(); updatePreview(); }
  $('.drawer__body').scrollTop = 0;
}

const entrega = () => checkout.querySelector('input[name="entrega"]:checked').value;

function syncDelivery() {
  const tipo = entrega();
  $$('[data-delivery]').forEach((el) => { el.hidden = tipo === 'retiro'; });

  const min = isoPlusDays(LEAD_DAYS[tipo]);
  fFecha.min = min;
  if (fFecha.value && fFecha.value < min) fFecha.value = '';

  // Efectivo solo si retira presencialmente
  [...fPago.options].find((o) => o.value === 'Efectivo').disabled = tipo !== 'retiro';
  if (tipo !== 'retiro') fPago.value = 'Transferencia';

  // ADAPTAR: políticas de anticipación y pago del negocio
  $('#fHint').textContent = tipo === 'retiro'
    ? `📌 Coordinamos día y hora de retiro por WhatsApp. Los grabados se preparan a pedido.`
    : tipo === 'domicilio'
      ? `📌 Pago por transferencia. El costo del despacho se coordina por WhatsApp.`
      : `📌 Pago por transferencia. El envío por encomienda es de cargo del cliente.`;
}

function getOrder() {
  const tipo = entrega();
  return {
    tipo,
    comuna: tipo === 'retiro' ? '' : $('#fComuna').value.trim(),
    direccion: tipo === 'retiro' ? '' : $('#fDireccion').value.trim(),
    fecha: fFecha.value,
    cliente: $('#fCliente').value.trim(),
    pago: fPago.value,
    comentario: $('#fComentario').value.trim(),
  };
}

// *texto* = negrita y _texto_ = cursiva en WhatsApp
function buildMessage(o) {
  const t = totals();
  const archivos = cart.some((l) => l.grabado && l.grabado.tipos.some(esArchivo));
  const L = [`🧉✨ *${cart.length ? 'PEDIDO' : 'COTIZACIÓN'} #${orderNumber}* ✨🧉`, '━━━━━━━━━━━━━━━'];
  cart.forEach((l, i) => {
    const p = findProduct(l.id);
    const unit = unitPrice(p, qtyOf(l.id));
    L.push(`*${i + 1}. ${p.name}* × ${l.qty}`);
    if (l.opcion) L.push(`   ▫️ ${p.opcionesTitulo || 'Opción'}: ${l.opcion}`);
    if (l.grabado) {
      L.push(`   ✍️ Grabado${p.grabado === 'opcional' ? ' (a cotizar)' : ''}:`);
      l.grabado.tipos.forEach((t) => L.push(esArchivo(t)
        ? `      • ${tipoDe(t).label}: _te lo envío por aquí_`
        : `      • ${tipoDe(t).label}: _"${(l.grabado.textos || {})[t] || ''}"_`));
    }
    if (l.nota) L.push(`   📝 ${l.nota}`);
    L.push(`   💲 ${clp(unit)} c/u${unit !== p.price ? ' (por mayor)' : ''} = ${clp(unit * l.qty)}`);
  });
  if (cart.length) L.push('━━━━━━━━━━━━━━━');
  if (o.comentario) L.push(`💬 *Comentario:* ${o.comentario}`);
  L.push(`🚚 *Entrega:* ${ENTREGAS[o.tipo]}`);
  if (o.comuna) L.push(`📍 *Comuna/Ciudad:* ${o.comuna}`);
  if (o.direccion) L.push(`🏠 *Dirección:* ${o.direccion}`);
  if (o.fecha) L.push(`📅 *Para el:* ${o.fecha.split('-').reverse().join('/')}`);
  if (o.cliente) L.push(`🙋 *Nombre:* ${o.cliente}`);
  L.push(`💳 *Pago:* ${o.pago}`);
  L.push('━━━━━━━━━━━━━━━');
  if (cart.length) {
    if (t.ahorro > 0) L.push(`🎉 Ahorro por mayor: ${clp(t.ahorro)}`);
    L.push(`💰 *TOTAL: ${clp(t.total)}*`);
    const pendientes = [];
    if (t.cotizar) pendientes.push('grabado opcional');
    if (o.tipo !== 'retiro') pendientes.push(o.tipo === 'region' ? 'envío' : 'despacho');
    if (pendientes.length) L.push(`_(+ ${pendientes.join(' y ')} a coordinar)_`);
  } else {
    L.push('💰 *TOTAL: A cotizar*');
  }
  if (archivos) L.push('📎 _Te adjunto el logo/imagen para el grabado._');
  L.push('');
  L.push(cart.length ? '¡Hola! Quiero hacer este pedido 🧉' : '¡Hola! Quiero cotizar un pedido 🧉');
  return L.join('\n');
}

// Vista previa con el formato de WhatsApp
function formatPreview(text) {
  return esc(text)
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_([^_\n]+)_/g, '$1<em>$2</em>');
}

function updatePreview() {
  $('#msgPreview').innerHTML = formatPreview(buildMessage(getOrder()));
}

checkout.addEventListener('input', updatePreview);
checkout.addEventListener('change', (e) => {
  if (e.target.name === 'entrega') syncDelivery();
  updatePreview();
});

$('#cartNext').addEventListener('click', () => goStep(2));
$('#cartBack').addEventListener('click', () => goStep(1));

checkout.addEventListener('submit', (e) => {
  e.preventDefault();
  const o = getOrder();
  const missing = [];
  if (!o.cliente) missing.push('tu nombre');
  if (o.tipo !== 'retiro' && !o.comuna) missing.push('comuna o ciudad');
  if (o.tipo !== 'retiro' && !o.direccion) missing.push('dirección');
  if (!cart.length && !o.comentario) missing.push('qué necesitas cotizar (en comentarios)');
  if (missing.length) {
    const err = $('#formError');
    err.textContent = 'Falta completar: ' + missing.join(', ') + '.';
    err.hidden = false;
    return;
  }
  window.open(waUrl(buildMessage(o)), '_blank', 'noopener');
  commitOrderNumber(orderNumber);
  orderNumber = nextOrderNumber();
  cart = [];
  saveCart();
  checkout.reset();
  renderCart();
  setOpen($('#cart'), false);
  toast(`${icon('i-check')}<span><strong>¡Pedido enviado!</strong> Te respondemos por WhatsApp.</span>`);
});

// ===== VISOR DE FOTOS =====
const viewer = $('#viewer');
let viewing = null;
let viewIdx = 0;

function showPhoto(i) {
  viewIdx = (i + viewing.gallery.length) % viewing.gallery.length;
  $('#viewerImg').src = viewing.gallery[viewIdx];
  $('#viewerImg').alt = viewing.name;
  $('#viewerCount').textContent = viewing.gallery.length > 1 ? `${viewIdx + 1} / ${viewing.gallery.length}` : '';
  viewer.querySelectorAll('[data-step]').forEach((b) => { b.hidden = viewing.gallery.length < 2; });
}
function openViewer(p, i = 0) {
  viewing = p;
  $('#viewerTitle').textContent = p.name;
  showPhoto(i);
  setOpen(viewer, true);
}

// Deslizar con el dedo para pasar de foto
let touchX = null;
viewer.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
viewer.addEventListener('touchend', (e) => {
  if (touchX === null || !viewing) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50 && viewing.gallery.length > 1) showPhoto(viewIdx + (dx < 0 ? 1 : -1));
  touchX = null;
});

// ===== CLICS Y TECLADO =====
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-close-viewer]')) { setOpen(viewer, false); return; }
  const step = t.closest('[data-step]');
  if (step) { showPhoto(viewIdx + Number(step.dataset.step)); return; }
  if (t.closest('[data-close-sheet]')) { setOpen(sheet, false); return; }
  if (t.closest('[data-close-cart]')) { setOpen($('#cart'), false); return; }
  const prod = t.closest('[data-product]');
  if (prod) { openSheet(prod.dataset.product); return; }
  if (t.closest('[data-open-cart]')) { $('#toast').classList.remove('is-on'); openCart(1); return; }
  if (t.closest('[data-quote]')) {
    openCart(2);
    setTimeout(() => $('#fComentario').focus(), 50);
  }
});
document.addEventListener('keydown', (e) => {
  if (viewer.classList.contains('is-open')) {
    if (e.key === 'Escape') setOpen(viewer, false);
    else if (e.key === 'ArrowRight') showPhoto(viewIdx + 1);
    else if (e.key === 'ArrowLeft') showPhoto(viewIdx - 1);
    return;
  }
  if (e.key !== 'Escape') return;
  if (sheet.classList.contains('is-open')) setOpen(sheet, false);
  else if ($('#cart').classList.contains('is-open')) setOpen($('#cart'), false);
});

$('#footerWa').href = waUrl();
$('#contactWa').href = waUrl();
$('#contactWaBtn').href = waUrl();

// Abierto / cerrado según la hora de Chile y el horario de data/ajustes.json
(function openStatus() {
  const el = $('#openStatus');
  const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const parts = new Intl.DateTimeFormat('es-CL', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: 'America/Santiago' }).formatToParts(new Date());
  const now = Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value);
  const abre = toMin(TIENDA.hora_abre), cierra = toMin(TIENDA.hora_cierra);
  const dia = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' })).getDay();
  const dias = Array.isArray(TIENDA.dias) ? TIENDA.dias : [0, 1, 2, 3, 4, 5, 6];
  // soporta horarios que pasan la medianoche (ej: 18:00 – 02:00)
  const open = dias.includes(dia) && (abre <= cierra ? now >= abre && now < cierra : now >= abre || now < cierra);
  el.textContent = open ? 'Abierto ahora' : 'Cerrado';
  el.className = 'status ' + (open ? 'is-open' : 'is-closed');
})();

// ===== CARGA DEL CATÁLOGO =====
async function loadProducts() {
  try {
    const res = await fetch('data/catalogo.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const categorias = Array.isArray(data.categorias) ? data.categorias : [];

    // producto -> categorías a las que pertenece (la categoría es la que dice qué productos tiene)
    const tagsOf = {};
    categorias.forEach((c) => (c.productos || []).forEach((id) => (tagsOf[id] = tagsOf[id] || []).push(c.id)));
    const nombreCat = Object.fromEntries(categorias.map((c) => [c.id, c.nombre]));
    const sinBarra = (f) => String(f).replace(/^\//, ''); // el CMS guarda "/img/productos/x.jpg"

    FILTERS = [['todos', 'Todos'], ...categorias.map((c) => [c.id, c.nombre])];
    PRODUCTS = (data.productos || []).map((p) => ({
      id: p.id,
      name: p.nombre,
      price: Number(p.precio) || 0,
      img: sinBarra(p.foto || 'img/logo.jpg'),
      // foto principal + fotos extra / afiches, para la ficha y el visor
      gallery: [p.foto || 'img/logo.jpg', ...(Array.isArray(p.galeria) ? p.galeria : [])].map(sinBarra),
      desc: p.descripcion || '',
      items: Array.isArray(p.incluye) ? p.incluye : [],
      tags: tagsOf[p.id] || [],
      category: nombreCat[(tagsOf[p.id] || [])[0]] || '',
      badge: p.etiqueta || '',
      mayor: p.precio_mayor && p.minimo_mayor ? { precio: Number(p.precio_mayor), desde: Number(p.minimo_mayor) } : null,
      grabado: p.grabado || '',
      grabadoDetalle: p.grabado_detalle || '',
      grabadoTipos: Array.isArray(p.grabado_tipos) ? p.grabado_tipos : [],
      grabadoMax: Number(p.grabado_max) || 0,
      opcionesTitulo: p.opciones_titulo || '',
      opciones: Array.isArray(p.opciones) ? p.opciones : [],
      agotado: !!p.agotado,
    }));
  } catch (e) {
    console.error(e);
    grid.innerHTML = '<p class="muted">No se pudo cargar el catálogo. Intenta recargar la página.</p>';
  }
  // descarta del carrito productos que ya no existen o se agotaron
  cart = cart.filter((l) => l && findProduct(l.id) && !findProduct(l.id).agotado && l.qty > 0);
  saveCart();
  renderFilters('todos');
  renderProducts('todos');
  renderCart();
}

loadProducts();
