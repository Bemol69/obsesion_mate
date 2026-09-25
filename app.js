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

const CUSTOM = { id: 'personalizado', name: 'Pedido personalizado / por mayor', price: 0 };

const SORTS = {
  destacados: null,
  'precio-asc': (a, b) => a.price - b.price,
  'precio-desc': (a, b) => b.price - a.price,
};

// ADAPTAR: extras que el cliente puede sumar al pedido (o [] si no aplica; entonces oculta el fieldset)
const EXTRAS = ['🥤 Bombilla acero y bronce', '🌡️ Termo de acero', '👜 Matero de cuero', '✍️ Grabado personalizado'];

// ===== UTILIDADES =====
const clp = (n) => '$' + n.toLocaleString('es-CL');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const findProduct = (id) => (id === CUSTOM.id ? CUSTOM : PRODUCTS.find((p) => p.id === id));
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

function renderProducts(cat = currentCat) {
  currentCat = cat;
  let list = cat === 'todos' ? PRODUCTS : PRODUCTS.filter((p) => p.tags.includes(cat));
  const sort = SORTS[$('#sort').value];
  if (sort) list = [...list].sort(sort);
  $('#count').innerHTML = `Mostrando <strong>${list.length}</strong> ${list.length === 1 ? 'producto' : 'productos'}`;
  grid.innerHTML = list.map((p) => `
    <article class="card${p.agotado ? ' is-soldout' : ''}">
      <div class="card__img">
        ${p.agotado ? '<span class="badge badge--soldout">Agotado</span>' : p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}
        <img src="${esc(p.img)}" alt="${esc(p.name)}" loading="lazy">
      </div>
      <div class="card__body">
        <h3>${esc(p.name)}</h3>
        ${p.desc ? `<p class="card__desc">${esc(p.desc)}</p>` : ''}
        <ul>${p.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
        <div class="card__foot">
          <span class="price">${clp(p.price)}</span>
          ${p.agotado
            ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(waUrl(`Hola! ¿Tienen stock de ${p.name}? 🧉`))}">Consultar stock</a>`
            : `<button class="btn btn--primary btn--sm" data-order="${p.id}">Hacer pedido</button>`}
        </div>
      </div>
    </article>`).join('');
}

filters.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  renderFilters(btn.dataset.cat);
  renderProducts(btn.dataset.cat);
});
$('#sort').addEventListener('change', () => renderProducts());

// ===== FORMULARIO / MODAL =====
const modal = $('#orderModal');
const form = $('#orderForm');
const fRamo = $('#fRamo');
const fFecha = $('#fFecha');
const fPago = $('#fPago');
let orderNumber = nextOrderNumber();

function renderRamoOptions() {
  fRamo.innerHTML =
    `<option value="${CUSTOM.id}">✨ ${CUSTOM.name} (a cotizar)</option>` +
    PRODUCTS.filter((p) => !p.agotado)
      .map((p) => `<option value="${p.id}">${esc(p.name)} (${clp(p.price)})</option>`).join('');
}

$('#fExtras').innerHTML = EXTRAS
  .map((x) => `<label><input type="checkbox" value="${x}"><span>${x}</span></label>`)
  .join('');

const entrega = () => form.querySelector('input[name="entrega"]:checked').value;

function syncDelivery() {
  const tipo = entrega();
  document.querySelectorAll('[data-delivery]').forEach((el) => { el.hidden = tipo === 'retiro'; });

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
    product: findProduct(fRamo.value),
    cantidad: Math.min(500, Math.max(1, parseInt($('#fCantidad').value, 10) || 1)),
    colores: $('#fColores').value.trim(),
    extras: [...document.querySelectorAll('#fExtras input:checked')].map((i) => i.value.replace(/^\S+\s/, '')),
    tipo,
    comuna: tipo === 'retiro' ? '' : $('#fComuna').value.trim(),
    direccion: tipo === 'retiro' ? '' : $('#fDireccion').value.trim(),
    fecha: fFecha.value,
    grabado: $('#fDedicatoria').value.trim(),
    cliente: $('#fCliente').value.trim(),
    pago: fPago.value,
  };
}

// Precio unitario según cantidad (precio por mayor si corresponde)
const unitPrice = (p, cantidad) => (p.mayor && cantidad >= p.mayor.desde ? p.mayor.precio : p.price);

// *texto* = negrita y _texto_ = cursiva en WhatsApp
function buildMessage(o) {
  const custom = o.product.id === CUSTOM.id;
  const unit = unitPrice(o.product, o.cantidad);
  const total = unit * o.cantidad;
  const L = [`🧉✨ *PEDIDO #${orderNumber}* ✨🧉`, '━━━━━━━━━━━━━━━'];
  L.push(`🧉 *Producto:* ${o.product.name}${custom ? '' : ` (${clp(o.product.price)})`}`);
  if (o.cantidad > 1) L.push(`🔢 *Cantidad:* ${o.cantidad}${!custom && unit !== o.product.price ? ` (precio por mayor ${clp(unit)} c/u)` : ''}`);
  if (o.colores) L.push(`🎨 *Color/modelo:* ${o.colores}`);
  if (o.extras.length) L.push(`➕ *Agregar:* ${o.extras.join(', ')}`);
  if (o.grabado) L.push(`✍️ *Grabado:* _"${o.grabado}"_`);
  L.push(`🚚 *Entrega:* ${ENTREGAS[o.tipo]}`);
  if (o.comuna) L.push(`📍 *Comuna/Ciudad:* ${o.comuna}`);
  if (o.direccion) L.push(`🏠 *Dirección:* ${o.direccion}`);
  if (o.fecha) L.push(`📅 *Para el:* ${o.fecha.split('-').reverse().join('/')}`);
  if (o.cliente) L.push(`🙋 *Nombre:* ${o.cliente}`);
  L.push(`💳 *Pago:* ${o.pago}`);
  L.push('━━━━━━━━━━━━━━━');
  L.push(custom ? '💰 *TOTAL: A cotizar*' : `💰 *TOTAL: ${clp(total)}*`);
  const pendientes = [];
  if (o.extras.length) pendientes.push('agregados');
  if (o.tipo !== 'retiro') pendientes.push(o.tipo === 'region' ? 'envío' : 'despacho');
  if (pendientes.length && !custom) L.push(`_(+ ${pendientes.join(' y ')} a coordinar)_`);
  L.push('');
  L.push('¡Hola! Quiero hacer este pedido 🧉');
  return L.join('\n');
}

// Vista previa con el formato de WhatsApp
function formatPreview(text) {
  return esc(text)
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_([^_\n]+)_/g, '$1<em>$2</em>');
}

function update() {
  const o = getOrder();
  $('#msgPreview').innerHTML = formatPreview(buildMessage(o));
  $('#fTotal').textContent = o.product.id === CUSTOM.id ? 'A cotizar' : clp(unitPrice(o.product, o.cantidad) * o.cantidad);
}

function openModal(productId) {
  if (productId && findProduct(productId)) fRamo.value = productId;
  $('#formError').hidden = true;
  syncDelivery();
  update();
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

document.addEventListener('click', (e) => {
  const orderBtn = e.target.closest('[data-order]');
  if (orderBtn) { openModal(orderBtn.dataset.order); return; }
  if (e.target.closest('[data-close]')) closeModal();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
form.addEventListener('input', update);
form.addEventListener('change', (e) => {
  if (e.target.name === 'entrega') syncDelivery();
  update();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const o = getOrder();
  const missing = [];
  if (!o.cliente) missing.push('tu nombre');
  if (o.tipo !== 'retiro' && !o.comuna) missing.push('comuna o ciudad');
  if (o.tipo !== 'retiro' && !o.direccion) missing.push('dirección');
  if (o.product.id === CUSTOM.id && !o.colores && !o.grabado && !o.extras.length) missing.push('qué producto o grabado necesitas');
  if (missing.length) {
    const err = $('#formError');
    err.textContent = 'Falta completar: ' + missing.join(', ') + '.';
    err.hidden = false;
    return;
  }
  window.open(waUrl(buildMessage(o)), '_blank', 'noopener');
  commitOrderNumber(orderNumber);
  orderNumber = nextOrderNumber();
  form.reset();
  closeModal();
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

    FILTERS = [['todos', 'Todos'], ...categorias.map((c) => [c.id, c.nombre])];
    PRODUCTS = (data.productos || []).map((p) => ({
      id: p.id,
      name: p.nombre,
      price: Number(p.precio) || 0,
      // el CMS guarda "/img/productos/x.jpg"; sin la barra inicial funciona también en GitHub Pages
      img: (p.foto || 'img/logo.jpg').replace(/^\//, ''),
      desc: p.descripcion || '',
      items: Array.isArray(p.incluye) ? p.incluye : [],
      tags: tagsOf[p.id] || [],
      badge: p.etiqueta || '',
      mayor: p.precio_mayor && p.minimo_mayor ? { precio: Number(p.precio_mayor), desde: Number(p.minimo_mayor) } : null,
      agotado: !!p.agotado,
    }));
  } catch (e) {
    console.error(e);
    grid.innerHTML = '<p class="muted">No se pudo cargar el catálogo. Intenta recargar la página.</p>';
  }
  renderFilters('todos');
  renderProducts('todos');
  renderRamoOptions();
}

loadProducts();
