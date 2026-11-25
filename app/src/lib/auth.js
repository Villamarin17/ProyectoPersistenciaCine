// Controles de acceso. Se verifican en el servidor en cada petición.
const oracle = require('../db/oracle');

// Cliente autenticado (cuenta de Oracle)
function requireClient(req, res, next) {
  if (!req.session.accountId) return res.redirect('/login');
  next();
}

// Perfil seleccionado: se vuelve a consultar en Oracle en cada petición, así un perfil
// desactivado o una suscripción vencida dejan de dar acceso de inmediato.
async function requireProfile(req, res, next) {
  try {
    if (!req.session.accountId) return res.redirect('/login');
    if (!req.session.profileId) return res.redirect('/perfiles');
    const p = await loadProfileAccess(req.session.accountId, req.session.profileId);
    if (!p || p.isActive !== 'Y') {
      req.session.profileId = null;
      req.session.flash = { type: 'error', text: 'El perfil no está activo. Seleccione otro perfil.' };
      return res.redirect('/perfiles');
    }
    if (!p.subscriptionId) {
      return res.status(403).render('rechazo', {
        title: 'Suscripción vencida',
        motivo: 'La cuenta no tiene una suscripción vigente. Contrate un plan para buscar y reproducir contenidos.',
        enlace: { href: '/cuenta', texto: 'Ver planes' }
      });
    }
    req.profile = p;
    res.locals.profile = p;
    next();
  } catch (e) { next(e); }
}

// Perfil con los datos de Oracle que necesita la autorización: pertenencia a la cuenta,
// estado, edad máxima y suscripción vigente (o NULL si no hay)
async function loadProfileAccess(accountId, profileId) {
  return oracle.queryOne(
    `SELECT profileId "profileId", accountId "accountId", profileName "profileName",
            maxAgeRating "maxAgeRating", isActive "isActive", subscriptionId "subscriptionId",
            planId "planId", planName "planName", endsAt "endsAt"
       FROM vw_profile_access
      WHERE profileId = :profileId AND accountId = :accountId`,
    { profileId, accountId });
}

// Administrador autenticado (colección admins de MongoDB) con el rol requerido
function requireAdmin(role) {
  return (req, res, next) => {
    const a = req.session.admin;
    if (!a) return res.redirect('/admin/login');
    if (role && !a.roles.includes(role)) {
      return res.status(403).render('rechazo', { title: 'Sin permiso', motivo: 'Su usuario administrativo no tiene el rol ' + role + '.', enlace: { href: '/admin', texto: 'Volver' } });
    }
    next();
  };
}

module.exports = { requireClient, requireProfile, requireAdmin, loadProfileAccess };
