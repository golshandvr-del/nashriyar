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
