// الأدوار والصلاحيات
const ROLES = {
  admin: 'مدير النظام',
  manager: 'مدير المصنع',
  supervisor: 'مشرف إنتاج',
  storekeeper: 'أمين مخزن',
  hr: 'شؤون الموظفين',
  viewer: 'مشاهدة فقط',
};

// لكل قسم: من يقدر يشوف (view) ومن يقدر يعدّل (edit)
const ALL = Object.keys(ROLES);
const PERMS = {
  dashboard:         { view: ALL, edit: [] },
  employees:         { view: ['admin', 'manager', 'hr', 'supervisor', 'viewer'], edit: ['admin', 'manager', 'hr'] },
  attendance:        { view: ['admin', 'manager', 'hr', 'supervisor', 'viewer'], edit: ['admin', 'manager', 'hr', 'supervisor'] },
  leaves:            { view: ['admin', 'manager', 'hr', 'viewer'], edit: ['admin', 'manager', 'hr'] },
  machines:          { view: ['admin', 'manager', 'supervisor', 'viewer'], edit: ['admin', 'manager', 'supervisor'] },
  molds:             { view: ['admin', 'manager', 'supervisor', 'storekeeper', 'viewer'], edit: ['admin', 'manager', 'supervisor'] },
  assets:            { view: ['admin', 'manager', 'storekeeper', 'viewer'], edit: ['admin', 'manager', 'storekeeper'] },
  products:          { view: ['admin', 'manager', 'supervisor', 'storekeeper', 'viewer'], edit: ['admin', 'manager', 'supervisor'] },
  materials:         { view: ['admin', 'manager', 'storekeeper', 'supervisor', 'viewer'], edit: ['admin', 'manager', 'storekeeper'] },
  stock_movements:   { view: ['admin', 'manager', 'storekeeper', 'viewer'], edit: ['admin', 'manager', 'storekeeper'] },
  production_orders: { view: ['admin', 'manager', 'supervisor', 'storekeeper', 'viewer'], edit: ['admin', 'manager', 'supervisor'] },
  production_logs:   { view: ['admin', 'manager', 'supervisor', 'viewer'], edit: ['admin', 'manager', 'supervisor'] },
  reports:           { view: ['admin', 'manager', 'supervisor', 'hr', 'viewer'], edit: [] },
  users:             { view: ['admin'], edit: ['admin'] },
};

const can = (user, section, action = 'view') =>
  !!user && !!PERMS[section] && PERMS[section][action].includes(user.role);

module.exports = { ROLES, PERMS, can };
