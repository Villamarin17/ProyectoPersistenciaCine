// Utilidades de presentación (zona horaria de Colombia) y exportación CSV.
const TZ = 'America/Bogota';
const OFFSET_HOURS = 5; // Colombia no tiene horario de verano: UTC-5

const dateTime = d => d ? new Date(d).toLocaleString('es-CO', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }) : '';
const date = d => d ? new Date(d).toLocaleDateString('es-CO', { timeZone: TZ, dateStyle: 'medium' }) : '';
const money = n => '$ ' + Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
const minutes = sec => Math.round((sec || 0) / 60) + ' min';
const clock = sec => {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
const typeName = t => ({ movie: 'Película', series: 'Serie', documentary: 'Documental' })[t] || t;
const statusName = s => ({ draft: 'Borrador', published: 'Publicado', retired: 'Retirado' })[s] || s;

// Fechas del filtro (AAAA-MM-DD, hora de Colombia) → rango UTC [desde, hasta+1 día)
function dateRange(desde, hasta) {
  const today = new Date(Date.now() - OFFSET_HOURS * 3600e3).toISOString().slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(desde || '') ? desde : today.slice(0, 8) + '01';
  const h = /^\d{4}-\d{2}-\d{2}$/.test(hasta || '') ? hasta : today;
  const from = new Date(d + 'T00:00:00Z'); from.setUTCHours(OFFSET_HOURS);
  const to = new Date(h + 'T00:00:00Z'); to.setUTCHours(OFFSET_HOURS); to.setUTCDate(to.getUTCDate() + 1);
  return { desde: d, hasta: h, from, to };
}

function toCsv(headers, rows) {
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n') + '\r\n';
}

module.exports = { dateTime, date, money, minutes, clock, typeName, statusName, dateRange, toCsv };
