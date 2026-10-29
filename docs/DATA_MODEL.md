# مدل داده (پایگاه داده)

> منبع واحد حقیقت در کد: `packages/db/schema.ts` (Drizzle). این سند طراحی مفهومی است.
> گویش: SQLite (D1 / better-sqlite3) با مسیر باز به PostgreSQL.
> قراردادها: کلید اصلی `id` از نوع متن (ULID — مرتب‌شونده بر اساس زمان)، زمان‌ها به‌صورت
> ISO-8601 UTC (`created_at`, `updated_at`)، حذف نرم با `deleted_at`. تبدیل به شمسی فقط در لایهٔ نمایش.

## ۱. نمودار کلی

```
universities ─┬─ faculties ─┬─ majors
              │             └─ associations (انجمن علمی / کانون فرهنگی)
              │                    │
              │              publications ──┬─ publication_roles (۳ نقش اصلی) ── users
              │                    │        ├─ publication_role_history
              │                    │        ├─ team_members (اعضا؛ اختیاری متصل به users)
              │                    │        ├─ publication_categories / publication_majors / keywords
              │                    │        ├─ sales_contacts
              │                    │        └─ issues ──┬─ issue_toc_items ── toc_item_assignments ── team_members
              │                    │                    ├─ issue_members (نقش‌های تولید)
              │                    │                    ├─ issue_stages / stage_events
              │                    │                    ├─ issue_assets (pdf, audio, video, image)
              │                    │                    ├─ issue_pages (تصاویر صفحات)
              │                    │                    ├─ access_codes ── entitlements ── users
              │                    │                    └─ physical_sales
              │                    └─ posts ── post_media, comments, highlights, stories
users ─┬─ sessions, follows, saved_posts, reading_progress, bookmarks, notes, reports
       └─ notifications
categories (درختی، نوع: subject | major | format | custom)
activity_events · audit_logs · view_events · daily_stats_* · insights · settings · feature_flags · announcements
```

## ۲. ساختار سازمانی

| جدول | فیلدهای کلیدی |
|---|---|
| `universities` | id, name, slug, logo_key, settings_json *(برای چنددانشگاهی شدن آینده؛ فعلاً یک ردیف)* |
| `faculties` | id, university_id, name, code, sort_order, is_active |
| `majors` | id, faculty_id, name, degree_level? |
| `associations` | id, faculty_id (nullable برای کانون‌های فرادانشکده‌ای), name, **kind** (`scientific_association` انجمن علمی / `cultural_club` کانون فرهنگی / `islamic_association` / `other`), established_at, is_active |

## ۳. کاربران و احراز هویت

| جدول | فیلدهای کلیدی |
|---|---|
| `users` | id, student_number (unique, nullable برای مدیران), username (unique), display_name, faculty_id?, major_id?, entry_year?, password_hash, password_algo, must_change_password, totp_secret_enc?, system_role (`super_admin`/`pub_officer`/`faculty_supervisor`/`analyst`/`student`), scope_faculty_id?, status (`active`/`suspended`), last_login_at |
| `sessions` | id (hash), user_id, created_at, expires_at, ip_hash, user_agent, revoked_at |
| `allowed_students` | student_number, national_id_hash?, faculty_id?, imported_at *(برای روش «فهرست مجاز»)* |
| `login_attempts` | key (user/IP), count, locked_until |

## ۴. نشریه و تیم

| جدول | فیلدهای کلیدی |
|---|---|
| `publications` | id, slug, title, tagline, description, association_id, faculty_id (مشتق/ذخیره برای گزارش سریع), license_number, license_issued_at, license_expires_at, frequency_declared (ماهنامه/فصلنامه/…), logo_key, cover_key, theme_color, status (`active`/`suspended`/`archived`), founded_at |
| `publication_roles` | id, publication_id, user_id, role (`managing_director`/`editor_in_chief`/`license_holder`), started_at, ended_at |
| `publication_role_history` | همان ساختار؛ هر تغییر نقش یک ردیف تاریخچه |
| `team_members` | id, publication_id, full_name, student_number?, user_id?, faculty_id?, major_id?, default_roles_json, joined_at, left_at, is_active |
| `publication_categories` | publication_id, category_id |
| `publication_majors` | publication_id, major_id |
| `keywords` / `entity_keywords` | id, text_normalized; entity_type (`publication`/`issue`/`toc_item`/`post`), entity_id, keyword_id |
| `sales_contacts` | id, publication_id, kind (`telegram`/`bale`/`eitaa`/`instagram`/`phone`/`other`), value, label, is_default |

## ۵. شماره‌ها و روند تولید

| جدول | فیلدهای کلیدی |
|---|---|
| `issues` | id, publication_id, number (شمارهٔ ترتیبی), title, subtitle, summary, cover_key, **status** (`planning`/`in_production`/`review`/`awaiting_approval`/`scheduled`/`published`/`archived`), progress_view (`timeline`/`checklist`/`kanban`), planned_publish_at, published_at, page_count, word_count?, language, **pricing** (`free`/`paid`), price_digital?, price_print?, print_run? (تیراژ چاپی), has_print_edition, free_preview_pages, created_by, editor_period_role_id (ارجاع به دورهٔ مدیرمسئول وقت) |
| `issue_categories` | issue_id, category_id *(موضوع این شماره می‌تواند از نشریه متفاوت باشد)* |
| `issue_toc_items` | id, issue_id, parent_id? (فهرست درختی: بخش/مقاله), sort_order, title, kind (`article`/`interview`/`translation`/`report`/`editorial`/`poem`/`other`), page_start?, page_end?, status (`todo`/`writing`/`written`/`editing`/`edited`/`designed`/`done`), due_at?, done_at? |
| `toc_item_assignments` | id, toc_item_id, team_member_id, role (`author`/`translator`/`editor`/`illustrator`/…), is_public_byline |
| `issue_members` | id, issue_id, team_member_id, production_role, responsibility_note |
| `production_roles` | id, name, is_default *(قابل ویرایش توسط مسئول)* |
| `stage_templates` | id, publication_id? (null = پیش‌فرض سامانه), name, stages_json |
| `issue_stages` | id, issue_id, key, title, sort_order, status (`pending`/`in_progress`/`done`/`skipped`), started_at, completed_at, due_at, owner_member_id? |
| `stage_events` | id, issue_id, stage_id?, toc_item_id?, from_status, to_status, actor_user_id, note, created_at *(منبع محاسبهٔ مدت هر مرحله — هرگز ویرایش نمی‌شود)* |
| `issue_approvals` *(پیشنهادی)* | id, issue_id, requested_by, decided_by, decision, note, decided_at |

## ۶. رسانه و نسخهٔ دیجیتال

| جدول | فیلدهای کلیدی |
|---|---|
| `media_assets` | id, owner_publication_id, kind (`pdf`/`audio`/`video`/`image`), storage_key, mime, size_bytes, duration_sec?, width?, height?, checksum, visibility (`public`/`private`/`entitled`), status (`uploading`/`processing`/`ready`/`failed`), uploaded_by |
| `issue_assets` | issue_id, asset_id, role (`main_pdf`/`podcast`/`clip`/`gallery`/`attachment`), title, toc_item_id?, sort_order, access (`free`/`paid`/`preview`) |
| `issue_pages` | id, issue_id, page_number, image_key_thumb, image_key_read, text_content (برای جست‌وجو) |

## ۷. فروش و دسترسی

| جدول | فیلدهای کلیدی |
|---|---|
| `access_codes` | id, issue_id, code_hash, code_last4, batch_id?, bound_student_number?, price_paid?, channel (`card_to_card`/`cash`/`free_gift`/`other`), note, created_by, created_at, expires_at, redeemed_at?, redeemed_by?, revoked_at? |
| `entitlements` | id, user_id, issue_id, source (`code`/`free`/`team`/`admin_grant`), access_code_id?, granted_at, revoked_at |
| `physical_sales` | id, issue_id, quantity, unit_price, sold_at, channel, recorded_by |
| `reading_sessions` | id, user_id, issue_id, started_at, last_seen_at, pages_viewed, device_hash, ended_reason |
| `reading_progress` | user_id, issue_id, last_page, percent, updated_at |
| `reader_bookmarks` / `reader_notes` | user_id, issue_id, page, text?, created_at *(کاملاً خصوصی)* |

## ۸. اکسپلور و تعامل

| جدول | فیلدهای کلیدی |
|---|---|
| `posts` | id, publication_id, kind (`image`/`carousel`/`video`), caption, **source_issue_id (NOT NULL)**, **source_toc_item_id (NOT NULL)**, status (`draft`/`published`/`hidden_by_team`/`hidden_by_admin`), published_at, scheduled_at?, created_by |
| `post_media` | post_id, asset_id, sort_order, alt_text |
| `highlights` | id, publication_id, title, cover_key, sort_order; `highlight_items` (highlight_id, post_id/story_id) |
| `stories` | id, publication_id, asset_id, source_issue_id, source_toc_item_id?, expires_at (۲۴ ساعت) |
| `follows` | user_id, publication_id, created_at, unfollowed_at? *(فقط برای مسئول قابل گزارش)* |
| `saved_posts` | user_id, post_id, created_at *(خصوصی)* |
| `comments` | id, post_id, user_id, parent_id? (پاسخ تیم), body, **status** (`pending`/`approved`/`rejected`/`spam`), moderated_by, moderated_at, reject_reason? |
| `reports` | id, reporter_user_id, entity_type, entity_id, reason, status, handled_by |
| `notifications` | id, user_id, type, payload_json, read_at |

## ۹. دسته‌بندی

| جدول | فیلدهای کلیدی |
|---|---|
| `categories` | id, parent_id?, **type** (`subject` موضوعی / `major` رشته‌ای / `format` قالب / `custom`), name, slug, icon, color, sort_order, is_active |
| `featured_shelves` | id, title, kind (`manual`/`rule`), rule_json?, starts_at, ends_at, sort_order; `featured_shelf_items` |
| `banners` | id, image_key, link, starts_at, ends_at |

## ۱۰. رویداد، ممیزی، آمار، بینش

| جدول | فیلدهای کلیدی |
|---|---|
| `activity_events` | id, actor_user_id, publication_id?, issue_id?, type (مثلاً `issue.created`, `toc.item.done`, `post.published`, `code.redeemed`), payload_json, created_at *(فقط‌افزودنی — پایهٔ تحلیل بلندمدت)* |
| `audit_logs` | id, actor_user_id, action, entity_type, entity_id, before_json, after_json, ip_hash, created_at |
| `view_events` | id, entity_type (`post`/`publication_page`/`issue_page`/`issue_read`/`category`/`search`), entity_id, publication_id, category_ids?, viewer_hash, user_id?, referrer_kind, created_at |
| `daily_stats_entity` | date, entity_type, entity_id, views, unique_viewers, reads, saves, comments_approved |
| `daily_stats_publication` | date, publication_id, views, new_follows, unfollows, codes_created, codes_redeemed, physical_sold, revenue_declared |
| `stats_rollup_state` | key, last_rolled_date *(برای rollup تنبل)* |
| `insights` | id, rule_key, severity (`alert`/`opportunity`/`info`), scope (publication/faculty/global), entity_id, title, body, data_json, created_at, dismissed_by?, dismissed_at? |

## ۱۱. پیکربندی و ارتباط

| جدول | فیلدهای کلیدی |
|---|---|
| `settings` | key, value_json, updated_by *(مثلاً مدت اعتبار پیش‌فرض کد، روش ثبت‌نام، الزام تأیید انتشار)* |
| `feature_flags` | key, enabled, rollout_json |
| `ai_settings` | provider, base_url, model, key_ref (ارجاع به secret، نه خود کلید), enabled, monthly_budget |
| `announcements` | id, author_id, audience (`all_teams`/`faculty`/`publication`), target_id?, title, body, pinned, created_at; `announcement_reads` |
| `deadlines` *(پیشنهادی)* | id, title, due_at, audience, related_event (مثلاً جشنوارهٔ نشریات) |
| `certificates` *(پیشنهادی)* | id, team_member_id, issue_id?, serial, verify_code, issued_at |
| `recruitment_calls` *(پیشنهادی)* | id, publication_id, title, roles_needed, body, open_until, contact |

## ۱۲. شاخص‌ها (Indexها)

- `issues(publication_id, status)`, `issues(published_at)`
- `stage_events(issue_id, created_at)`, `activity_events(publication_id, created_at)`, `activity_events(type, created_at)`
- `view_events(entity_type, entity_id, created_at)`, `view_events(publication_id, created_at)`
- `access_codes(code_hash)` unique, `access_codes(issue_id, created_at)`
- `entitlements(user_id, issue_id)` unique
- `posts(publication_id, published_at)`, `posts(status, published_at)`
- `comments(post_id, status)`, `follows(publication_id)`
- جست‌وجوی متن: جدول **FTS5** روی عنوان، توضیح، کلیدواژه‌ها، فهرست مطالب و متن صفحات
  (با نرمال‌سازی فارسی پیش از درج)؛ در PostgreSQL معادل آن `tsvector`.

## ۱۳. نگهداشت داده

- `view_events` خام: نگهداری ۱۸ ماه، سپس فقط تجمیعی‌ها (بی‌نهایت).
- `activity_events`، `stage_events`، `audit_logs`: نگهداری دائمی.
- مهاجرت‌ها فقط رو به جلو و با شماره‌گذاری (`migrations/0001_...sql`)، همراه با داده‌های نمونه (seed)
  برای توسعه و پیش‌نمایش.
