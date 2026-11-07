// الترجمة: النصوص مكتوبة بالعربي في الكود، والقاموس ده بيحولها للإنجليزي
const EN = {
  // عام
  'إدارة المصنع': 'Factory Management', 'تسجيل الدخول': 'Login', 'اسم المستخدم': 'Username', 'كلمة المرور': 'Password',
  'دخول': 'Sign in', 'خروج': 'Logout', 'خطأ': 'Error', 'الرجوع للرئيسية': 'Back to home', 'حفظ': 'Save', 'إلغاء': 'Cancel',
  'تعديل': 'Edit', 'حذف': 'Delete', 'إضافة': 'Add', 'بحث...': 'Search...', 'من': 'From', 'إلى': 'To', 'تصفية': 'Filter', 'مسح': 'Clear',
  'الكل': 'All', 'لا توجد بيانات': 'No data', 'متأكد من الحذف؟': 'Are you sure you want to delete?', '— اختر —': '— Select —',
  'حفظ وإضافة جديد': 'Save & add another', 'عرض': 'Show', 'طباعة': 'Print', 'English': 'English', 'عربي': 'عربي',
  'القائمة': 'Menu', 'الإعدادات': 'Settings', 'الأحد': 'Sunday', 'الاثنين': 'Monday', 'الثلاثاء': 'Tuesday',
  'الأربعاء': 'Wednesday', 'الخميس': 'Thursday', 'الجمعة': 'Friday', 'السبت': 'Saturday',
  'أيام الراحة الأسبوعية': 'Weekly days off', 'تفعيل قسم الإجازات': 'Enable the Leaves section',
  'لو المصنع بدأ يدي إجازات (اعتيادية، مرضية، ...) فعّل القسم ده.': 'Turn this on if the factory starts granting leaves (annual, sick, ...).',
  'أيام الراحة مابتتحسبش غياب، وشاشة الحضور بتسجلها «راحة» تلقائياً.': "Days off don't count as absence; the attendance screen marks them as Day Off automatically.",
  'اليوم ده راحة أسبوعية': 'This is a weekly day off',
  'اليوم ده راحة أسبوعية، والكل متسجل «راحة» تلقائياً. لو حد اشتغل غيّر حالته لـ «حاضر» واحفظ.': 'This is a weekly day off; everyone is marked Day Off. If someone worked, change them to Present and save.',
  'أيام العمل في الفترة: {0} (من غير أيام الراحة الأسبوعية)': 'Working days in period: {0} (excluding weekly days off)', 'نسبة الحضور': 'Attendance %', 'من أصل': 'of',
  // القائمة
  'الرئيسية': 'Home', 'لوحة التحكم': 'Dashboard', 'تقارير الإنتاجية': 'Productivity Reports', 'الإنتاج': 'Production',
  'الإنتاج اليومي': 'Daily Production', 'أوامر التشغيل': 'Work Orders', 'المنتجات': 'Products', 'المعدات': 'Equipment',
  'الماكينات': 'Machines', 'الإسطمبات': 'Molds', 'الأصول': 'Assets', 'المخزن': 'Warehouse', 'المواد الخام': 'Raw Materials',
  'حركات المخزن': 'Stock Movements', 'الموظفين': 'Employees', 'الحضور والانصراف': 'Attendance', 'الإجازات': 'Leaves',
  'النظام': 'System', 'المستخدمين والصلاحيات': 'Users & Permissions', 'المستخدمين': 'Users', 'التقارير': 'Reports',
  // الأدوار
  'مدير النظام': 'System Admin', 'مدير المصنع': 'Factory Manager', 'مشرف إنتاج': 'Production Supervisor',
  'أمين مخزن': 'Storekeeper', 'شؤون الموظفين': 'HR', 'مشاهدة فقط': 'View Only',
  // الأقسام (مفرد)
  'موظف': 'Employee', 'ماكينة': 'Machine', 'منتج': 'Product', 'إسطمبة': 'Mold', 'أصل': 'Asset', 'مادة خام': 'Raw Material',
  'حركة مخزن': 'Stock Movement', 'أمر تشغيل': 'Work Order', 'تسجيل إنتاج': 'Production Entry', 'طلب إجازة': 'Leave Request',
  // الحقول
  'الكود': 'Code', 'الاسم': 'Name', 'الوظيفة': 'Job Title', 'القسم': 'Department', 'التليفون': 'Phone',
  'تاريخ التعيين': 'Hire Date', 'المستهدف اليومي (قطعة)': 'Daily Target (pcs)', 'رصيد الإجازات السنوي (يوم)': 'Annual Leave Balance (days)',
  'الحالة': 'Status', 'ملاحظات': 'Notes', 'النوع': 'Type', 'المكان': 'Location', 'الطاقة (قطعة/ساعة)': 'Capacity (pcs/hour)',
  'الوحدة': 'Unit', 'المنتج': 'Product', 'عدد العيون': 'Cavities', 'مكان التخزين': 'Storage Location',
  'عدد ضربات سابقة': 'Previous Shots', 'صيانة كل (ضربة)': 'Maintenance Every (shots)', 'تاريخ آخر صيانة': 'Last Maintenance',
  'إجمالي الضربات': 'Total Shots', 'ضربات منذ الصيانة': 'Shots Since Maintenance', 'الفئة': 'Category',
  'تاريخ الشراء': 'Purchase Date', 'تكلفة الشراء': 'Purchase Cost', 'المورد': 'Supplier', 'العهدة مع': 'Custodian',
  'حد الطلب': 'Reorder Level', 'تكلفة الوحدة': 'Unit Cost', 'الرصيد الحالي': 'Current Stock', 'التاريخ': 'Date',
  'المادة': 'Material', 'نوع الحركة': 'Movement Type', 'الكمية': 'Quantity', 'أمر التشغيل (للصرف)': 'Work Order (for issue)',
  'رقم المستند / الإذن': 'Document No.', 'رقم الأمر': 'Order No.', 'الكمية المطلوبة': 'Planned Qty', 'تاريخ البدء': 'Start Date',
  'تاريخ التسليم': 'Due Date', 'المنتج فعلياً': 'Produced', 'نسبة الإنجاز': 'Progress', 'الوردية': 'Shift', 'الموظف': 'Employee',
  'الماكينة': 'Machine', 'الإسطمبة': 'Mold', 'أمر التشغيل': 'Work Order', 'الكمية المنتجة (سليم)': 'Good Qty Produced',
  'الهالك': 'Scrap', 'ساعات التشغيل': 'Run Hours', 'دقائق التوقف': 'Downtime (min)', 'سبب التوقف': 'Downtime Reason',
  'نوع الإجازة': 'Leave Type', 'عدد الأيام': 'Days', 'يُحسب تلقائياً لو سبته فاضي': 'Calculated automatically if left empty',
  'السبب': 'Reason',
  // الحالات
  'على رأس العمل': 'Active', 'متوقف': 'Inactive', 'تعمل': 'Running', 'متوقفة': 'Stopped', 'صيانة': 'Maintenance', 'عطلانة': 'Broken',
  'متاحة': 'Available', 'على الماكينة': 'On Machine', 'تالفة': 'Damaged', 'في الخدمة': 'In Service', 'مستبعد': 'Retired',
  'وارد': 'Receipt', 'صرف': 'Issue', 'تسوية (+/-)': 'Adjustment (+/-)', 'مفتوح': 'Open', 'قيد التشغيل': 'In Progress',
  'منتهي': 'Done', 'ملغي': 'Cancelled', 'صباحي': 'Morning', 'مسائي': 'Evening', 'ليلي': 'Night', 'اعتيادية': 'Annual',
  'عارضة': 'Casual', 'مرضية': 'Sick', 'بدون أجر': 'Unpaid', 'أخرى': 'Other', 'قيد المراجعة': 'Pending', 'موافق عليها': 'Approved',
  'مرفوضة': 'Rejected', 'حاضر': 'Present', 'متأخر': 'Late', 'غائب': 'Absent', 'إجازة': 'Leave', 'راحة': 'Day Off',
  // لوحة التحكم
  'حاضر من الموظفين': 'Employees present', 'في إجازة': 'On leave', 'إنتاج اليوم (سليم)': "Today's good output", 'هالك': 'Scrap',
  'دقائق توقف': 'Downtime minutes', 'طلبات إجازة تنتظر': 'Pending leave requests', 'الماكينات اليوم': 'Machines Today',
  'الساعات': 'Hours', 'الكفاءة': 'Efficiency', 'لم تُسجَّل ماكينات بعد': 'No machines yet', 'أوامر التشغيل المفتوحة': 'Open Work Orders',
  'الأمر': 'Order', 'التسليم': 'Due', 'الإنجاز': 'Progress', 'لا توجد أوامر مفتوحة': 'No open orders',
  'مواد خام وصلت لحد الطلب': 'Materials at Reorder Level', 'الرصيد': 'Stock', 'كل المواد فوق حد الطلب': 'All materials above reorder level',
  'إسطمبات تحتاج صيانة': 'Molds Needing Maintenance', 'لا توجد تنبيهات': 'No alerts',
  // الحضور
  'الكل حاضر': 'Mark all present', 'حفظ الحضور': 'Save attendance', 'حضور': 'In', 'انصراف': 'Out',
  'إجازة معتمدة': 'Approved leave', 'أضف الموظفين أولاً من شاشة الموظفين': 'Add employees first from the Employees page',
  // التقارير
  'إنتاجية الموظفين': 'Employee Productivity', 'أيام حضور': 'Days Present', 'غياب': 'Absent', 'تأخير': 'Late',
  'أيام إنتاج': 'Production Days', 'نسبة الهالك': 'Scrap %', 'قطعة/ساعة': 'Pcs/Hour', 'متوسط يومي': 'Daily Avg',
  'تحقيق المستهدف': 'Target Achieved', 'إنتاجية الماكينات': 'Machine Productivity', 'الطاقة': 'Capacity', 'الإتاحية': 'Availability',
  'الكفاءة = الإنتاج ÷ (الطاقة × ساعات التشغيل). الإتاحية = وقت التشغيل الفعلي بعد خصم التوقفات':
    'Efficiency = output ÷ (capacity × run hours). Availability = actual run time after downtime',
  'لا يوجد إنتاج مسجل في الفترة دي': 'No production recorded in this period',
  // المستخدمين
  'تعديل مستخدم': 'Edit User', 'إضافة مستخدم': 'Add User', 'اسم الدخول': 'Username', 'الاسم الكامل': 'Full Name', 'الدور': 'Role',
  '(اتركها فاضية لو مش هتغيرها)': '(leave empty to keep)', 'الحساب مفعّل': 'Account active', 'مفعّل': 'Active', 'موقوف': 'Disabled',
  'جدول الصلاحيات': 'Permissions Matrix', '✏️ تعديل': '✏️ Edit', '👁 عرض': '👁 View',
  'تغيير كلمة المرور': 'Change Password', 'كلمة المرور الحالية': 'Current password', 'كلمة المرور الجديدة': 'New password',
  // الرسائل
  'اسم المستخدم أو كلمة المرور غلط': 'Wrong username or password', 'ليس لديك صلاحية لهذه الصفحة': "You don't have permission for this page",
  'الصفحة غير موجودة': 'Page not found', 'السجل غير موجود': 'Record not found', 'تم حفظ الحضور': 'Attendance saved',
  'دور غير صحيح': 'Invalid role', 'لا يمكنك إيقاف حسابك أو تغيير دورك': "You can't disable your own account or change your role",
  'كلمة المرور لازم تكون 6 حروف على الأقل': 'Password must be at least 6 characters', 'تم الحفظ': 'Saved',
  'اسم المستخدم موجود بالفعل': 'Username already exists', 'كلمة المرور الحالية غلط': 'Current password is wrong',
  'كلمة المرور الجديدة لازم 6 حروف على الأقل': 'New password must be at least 6 characters', 'تم تغيير كلمة المرور': 'Password changed',
  'تم الحفظ بنجاح': 'Saved successfully', 'الكود ده مستخدم قبل كده': 'This code is already used', 'خطأ في الحفظ: {0}': 'Save error: {0}',
  'تم الحذف': 'Deleted', 'لا يمكن الحذف لأن السجل مرتبط ببيانات أخرى': 'Cannot delete: record is linked to other data',
  'حقل "{0}" مطلوب': '"{0}" is required', 'الكمية المطلوب صرفها أكبر من الرصيد المتاح ({0})': 'Issue quantity exceeds available stock ({0})',
  'الكمية لازم تكون أكبر من صفر': 'Quantity must be greater than zero', 'تاريخ النهاية قبل تاريخ البداية': 'End date is before start date',
};

const LANGS = ['ar', 'en'];
// msg: نص، أو [نص فيه {0} {1}, ...قيم]
function translator(lang) {
  const tr = (s) => (lang === 'en' && EN[s] !== undefined ? EN[s] : s);
  return (msg) => {
    if (msg === null || msg === undefined) return '';
    if (Array.isArray(msg)) {
      const [k, ...args] = msg;
      return tr(k).replace(/\{(\d+)\}/g, (_, i) => tr(String(args[i])));
    }
    return tr(String(msg));
  };
}

module.exports = { EN, LANGS, translator };
