// بيانات تجريبية للعرض والتدريب: npm run seed-demo
// تحذير: بيمسح كل البيانات الحالية (ما عدا المستخدمين والإعدادات)
// npm run seed-demo -- --keep-employees  => بيسيب الموظفين الحاليين ويعمل عليهم إنتاج وحضور
const db = require('../src/db');
const { seedDemo } = require('../src/demo');
const n = seedDemo(db, { keepEmployees: process.argv.includes('--keep-employees') });
console.log(`Demo data added (${n} employees)`);
