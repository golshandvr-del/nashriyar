// Column definitions of the unified DataTables (ROADMAP phase 18), shared by the web view and the server export so
// both show and write exactly the same columns, labels and filters.
import type { TableColumn } from './table'
import { SYSTEM_ROLE_LABEL } from './roles'
import { ASSOC_KIND, FREQUENCY, ISSUE_STATUS_LABEL, PUB_STATUS } from './labels'

export const DEGREE_LABEL: Record<string, string> = { associate: 'کاردانی', bachelor: 'کارشناسی', master: 'کارشناسی ارشد', phd: 'دکتری' }
export const GENDER_LABEL: Record<string, string> = { male: 'مرد', female: 'زن' }
export const USER_STATUS_LABEL: Record<string, string> = { active: 'فعال', suspended: 'تعلیق', pending: 'در انتظار' }

/** /admin/users */
export const USER_COLUMNS: TableColumn[] = [
  { key: 'display_name', label: 'نام' },
  { key: 'username', label: 'نام کاربری' },
  { key: 'student_number', label: 'شمارهٔ دانشجویی' },
  { key: 'system_role', label: 'نقش', labels: SYSTEM_ROLE_LABEL, filter: 'select', groupable: true, total: 'count' },
  { key: 'status', label: 'وضعیت', labels: USER_STATUS_LABEL, filter: 'select', groupable: true },
  { key: 'faculty_name', label: 'دانشکده', filter: 'select', groupable: true },
  { key: 'degree', label: 'مقطع', labels: DEGREE_LABEL, filter: 'select', groupable: true },
  { key: 'entry_year', label: 'سال ورود', type: 'number', filter: 'number', groupable: true },
  { key: 'publications', label: 'نشریات (سمت)', list: true, filter: 'select', groupable: true },
  { key: 'memberships', label: 'عضویت تیم', list: true, hidden: true },
  { key: 'last_login_at', label: 'آخرین ورود', type: 'datetime', filter: 'date' },
  { key: 'created_at', label: 'تاریخ ایجاد', type: 'date', filter: 'date', hidden: true }
]

/** /admin/people — person dossiers across publications */
export const PEOPLE_COLUMNS: TableColumn[] = [
  { key: 'full_name', label: 'نام' },
  { key: 'student_number', label: 'شمارهٔ دانشجویی' },
  { key: 'publications', label: 'نشریات', list: true, filter: 'select', groupable: true },
  { key: 'publication_count', label: 'تعداد نشریه', type: 'number', filter: 'number', groupable: true },
  { key: 'issue_count', label: 'شماره‌ها', type: 'number', filter: 'number', total: 'sum' },
  { key: 'section_count', label: 'بخش‌ها', type: 'number', filter: 'number', total: 'sum' }
]

/** /admin/publications */
export const PUB_COLUMNS: TableColumn[] = [
  { key: 'title', label: 'نشریه' },
  { key: 'status', label: 'وضعیت', labels: PUB_STATUS, filter: 'select', groupable: true },
  { key: 'faculty_name', label: 'دانشکده', filter: 'select', groupable: true },
  { key: 'association_name', label: 'صاحب امتیاز', filter: 'select', groupable: true },
  { key: 'association_kind', label: 'نوع تشکل', labels: ASSOC_KIND, filter: 'select', groupable: true, hidden: true },
  { key: 'frequency', label: 'دورهٔ انتشار', labels: FREQUENCY, filter: 'select', groupable: true },
  { key: 'published_count', label: 'منتشرشده', type: 'number', filter: 'number', total: 'sum' },
  { key: 'in_progress_count', label: 'در جریان', type: 'number', filter: 'number', total: 'sum' },
  { key: 'last_published_at', label: 'آخرین انتشار', type: 'date', filter: 'date' },
  { key: 'license_number', label: 'شمارهٔ مجوز' },
  { key: 'license_expires_at', label: 'انقضای مجوز', type: 'date', filter: 'date' },
  { key: 'member_count', label: 'اعضا', type: 'number', filter: 'number', total: 'sum', hidden: true },
  { key: 'follower_count', label: 'دنبال‌کننده', type: 'number', filter: 'number', total: 'sum', hidden: true },
  { key: 'last_activity_at', label: 'آخرین فعالیت', type: 'datetime', filter: 'date' }
]

export const ACTIVE_LABEL: Record<string, string> = { '1': 'فعال', '0': 'غیرفعال' }

/** /team/:pubId/members */
export const MEMBER_COLUMNS: TableColumn[] = [
  { key: 'full_name', label: 'نام' },
  { key: 'student_number', label: 'شمارهٔ دانشجویی' },
  { key: 'default_role', label: 'نقش پیش‌فرض', filter: 'select', groupable: true },
  { key: 'faculty_name', label: 'دانشکده', filter: 'select', groupable: true },
  { key: 'major_name', label: 'رشته', filter: 'select', groupable: true, hidden: true },
  { key: 'is_active', label: 'وضعیت', labels: ACTIVE_LABEL, filter: 'select', groupable: true },
  { key: 'issue_count', label: 'شماره‌ها', type: 'number', filter: 'number', total: 'sum' },
  { key: 'section_count', label: 'بخش‌ها', type: 'number', filter: 'number', total: 'sum' },
  { key: 'joined_at', label: 'پیوستن', type: 'date', filter: 'date' },
  { key: 'left_at', label: 'خروج', type: 'date', filter: 'date', hidden: true },
  { key: 'phone', label: 'تلفن', hidden: true }
]

export const PRICING_LABEL: Record<string, string> = { free: 'رایگان', paid: 'پولی' }

/** /team/:pubId/issues */
export const ISSUE_COLUMNS: TableColumn[] = [
  { key: 'number', label: 'شماره', type: 'number' },
  { key: 'title', label: 'عنوان' },
  { key: 'status', label: 'وضعیت', labels: ISSUE_STATUS_LABEL, filter: 'select', groupable: true, total: 'count' },
  { key: 'pricing', label: 'قیمت‌گذاری', labels: PRICING_LABEL, filter: 'select', groupable: true },
  { key: 'page_count', label: 'صفحات', type: 'number', filter: 'number', total: 'sum' },
  { key: 'toc_done', label: 'مطالب نهایی', type: 'number', total: 'sum' },
  { key: 'toc_total', label: 'کل مطالب', type: 'number', total: 'sum' },
  { key: 'planned_publish_at', label: 'برنامهٔ انتشار', type: 'date', filter: 'date' },
  { key: 'published_at', label: 'تاریخ انتشار', type: 'date', filter: 'date' },
  { key: 'updated_at', label: 'آخرین تغییر', type: 'datetime', filter: 'date', hidden: true }
]
