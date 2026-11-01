// Column definitions of the unified DataTables (ROADMAP phase 18), shared by the web view and the server export so
// both show and write exactly the same columns, labels and filters.
import type { TableColumn } from './table'
import { SYSTEM_ROLE_LABEL } from './roles'

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
