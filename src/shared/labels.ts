// Persian label maps shared by the web UI and the server (DataTable columns + streaming exports, ROADMAP phase 18).

export const ISSUE_STATUS: Record<string, { label: string; tone: 'muted' | 'brand' | 'warn' | 'ok' | 'danger' }> = {
  planning: { label: 'برنامه‌ریزی', tone: 'muted' },
  in_production: { label: 'در حال تولید', tone: 'brand' },
  awaiting_approval: { label: 'در انتظار تأیید', tone: 'warn' },
  changes_requested: { label: 'نیازمند اصلاح', tone: 'danger' },
  published: { label: 'منتشرشده', tone: 'ok' },
  archived: { label: 'بایگانی', tone: 'muted' }
}

export const TOC_STATUS: Record<string, string> = {
  todo: 'شروع‌نشده',
  writing: 'در حال نگارش',
  written: 'نوشته‌شده',
  editing: 'در حال ویرایش',
  edited: 'ویرایش‌شده',
  done: 'نهایی'
}

export const STAGE_STATUS: Record<string, string> = { pending: 'در انتظار', in_progress: 'در جریان', done: 'انجام‌شده', skipped: 'ردشده' }

export const PUB_STATUS: Record<string, string> = { active: 'فعال', suspended: 'تعلیق', archived: 'بایگانی' }

export const FREQUENCY: Record<string, string> = {
  monthly: 'ماهنامه',
  bimonthly: 'دوماهنامه',
  quarterly: 'فصلنامه',
  biannual: 'دوفصلنامه',
  irregular: 'گاهنامه'
}

export const ASSOC_KIND: Record<string, string> = {
  scientific_association: 'انجمن علمی',
  cultural_club: 'کانون فرهنگی',
  islamic_association: 'انجمن اسلامی',
  other: 'سایر'
}

export const CHANNEL: Record<string, string> = { card_to_card: 'کارت‌به‌کارت', cash: 'نقدی', gift: 'هدیه', other: 'سایر' }

export const CODE_STATE: Record<string, string> = { active: 'فعال', redeemed: 'استفاده‌شده', expired: 'منقضی', revoked: 'باطل‌شده' }

export const COMMENT_STATUS: Record<string, string> = { pending: 'در انتظار بررسی', approved: 'تأییدشده', rejected: 'ردشده', spam: 'هرزنامه' }

/** status → label only (for table columns / exports) */
export const ISSUE_STATUS_LABEL: Record<string, string> = Object.fromEntries(Object.entries(ISSUE_STATUS).map(([k, v]) => [k, v.label]))

// Audit log (ROADMAP phase 18 — shared by the events DataTable and its server export)
/** Action prefixes → Persian group labels (server stores dotted action names, e.g. "user.password_reset"). */
export const AUDIT_GROUPS: Record<string, string> = {
  '': 'همه',
  'publication': 'نشریه',
  'user': 'کاربر',
  'issue': 'شماره',
  'approval': 'تأیید',
  'post': 'پست',
  'comment': 'نظر',
  'report': 'گزارش',
  'category': 'دسته‌بندی',
  'shelf': 'ویترین',
  'announcement': 'اطلاعیه',
  'deadline': 'مهلت',
  'settings': 'تنظیمات'
}

export const AUDIT_ACTION_FA: Record<string, string> = {
  'publication.create': 'ایجاد نشریه',
  'publication.update': 'ویرایش نشریه',
  'publication.status': 'تغییر وضعیت نشریه',
  'publication.role_replace': 'تعویض رکن نشریه',
  'user.create': 'ایجاد کاربر',
  'user.status': 'تغییر وضعیت کاربر',
  'user.password_reset': 'بازنشانی رمز',
  'post.visibility': 'تغییر نمایش پست',
  'comment.approve': 'تأیید نظر',
  'comment.reject': 'رد نظر',
  'comment.spam': 'هرزنامه',
  'report.resolved': 'رسیدگی به گزارش',
  'report.dismissed': 'رد گزارش',
  'report.open': 'بازگشایی گزارش',
  'shelf.save': 'ذخیرهٔ قفسه',
  'shelf.delete': 'حذف قفسه',
  'banners.update': 'به‌روزرسانی بنرها',
  'announcement.create': 'ارسال اطلاعیه',
  'announcement.delete': 'حذف اطلاعیه',
  'deadline.create': 'ثبت مهلت',
  'deadline.delete': 'حذف مهلت',
  'settings.update': 'تغییر تنظیمات'
}
