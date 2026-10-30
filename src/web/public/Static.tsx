import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Compass, RefreshCw, TriangleAlert } from 'lucide-react'

/**
 * Friendly "something went wrong" page (ROADMAP phase 9). Catches render errors and failed lazy-chunk loads
 * (typical right after a new version is deployed: old chunk names no longer exist → one automatic reload).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    const chunk = /Loading chunk|dynamically imported module|Importing a module script failed/i.test(error?.message || '')
    if (chunk && !sessionStorage.getItem('nsh-chunk-reload')) {
      sessionStorage.setItem('nsh-chunk-reload', '1')
      location.reload()
      return
    }
    console.error(error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <TriangleAlert className="mx-auto size-12 text-amber-500" />
        <h1 className="mt-3 text-2xl font-extrabold">مشکلی پیش آمد</h1>
        <p className="mt-2 text-sm text-muted">خطای غیرمنتظره‌ای رخ داد. صفحه را دوباره بارگذاری کنید؛ اگر مشکل ادامه داشت با مسئول سامانه تماس بگیرید.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button className="btn-primary inline-flex items-center gap-2" onClick={() => location.reload()}>
            <RefreshCw className="size-4" /> بارگذاری دوباره
          </button>
          <a href="/" className="btn border border-line">
            خانه
          </a>
        </div>
      </div>
    )
  }
}

export function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Compass className="mx-auto size-12 text-muted" />
      <h1 className="mt-3 text-2xl font-extrabold">صفحه پیدا نشد</h1>
      <p className="mt-2 text-sm text-muted">نشانی وارد‌شده وجود ندارد یا جابه‌جا شده است.</p>
      <Link to="/" className="btn-primary mt-6 inline-flex">
        بازگشت به خانه
      </Link>
    </div>
  )
}

export function Terms() {
  return (
    <article className="prose-fa mx-auto max-w-2xl space-y-4 text-sm leading-8">
      <h1 className="text-xl font-extrabold">قوانین استفاده و حریم خصوصی</h1>
      <section>
        <h2 className="font-bold">۱. هدف سامانه</h2>
        <p>نشریار بستری برای انتشار و مطالعهٔ نشریات دانشجویی دانشگاه است. محتوای هر نشریه متعلق به صاحب امتیاز آن است و مسئولیت آن با مدیرمسئول نشریه است.</p>
      </section>
      <section>
        <h2 className="font-bold">۲. حساب کاربری</h2>
        <p>ثبت‌نام دانشجویان با شمارهٔ دانشجویی انجام می‌شود. حفظ رمز عبور بر عهدهٔ کاربر است. حساب‌های تیم نشریه و مدیران فقط توسط مسئول نشریات صادر می‌شوند.</p>
      </section>
      <section>
        <h2 className="font-bold">۳. کپی‌رایت و کتاب‌خوان</h2>
        <p>شماره‌های پولی فقط برای خریدار و در کتاب‌خوان سامانه قابل مطالعه‌اند. هر صفحه با نشان‌آب شخصی نمایش داده می‌شود. بازنشر، عکس‌برداری انبوه یا دور زدن محدودیت‌ها ممنوع است و می‌تواند به تعلیق حساب بینجامد.</p>
      </section>
      <section>
        <h2 className="font-bold">۴. کد خرید</h2>
        <p>هر کد خرید فقط یک بار قابل ثبت است و پس از ثبت، شماره برای همیشه به کتابخانهٔ شما افزوده می‌شود. کدهای منقضی‌شده یا باطل‌شده پذیرفته نمی‌شوند.</p>
      </section>
      <section>
        <h2 className="font-bold">۵. نظرها و گزارش‌ها</h2>
        <p>نظرها پیش از انتشار بررسی می‌شوند. توهین، افشای اطلاعات شخصی، تبلیغات و هرزنامه حذف می‌شود. برای گزارش تخلف از دکمهٔ «گزارش» استفاده کنید.</p>
      </section>
      <section>
        <h2 className="font-bold">۶. حریم خصوصی</h2>
        <p>آمار بازدید به‌صورت ناشناس و تجمیعی (با شناسهٔ درهم‌سازی‌شدهٔ روزانه) ثبت می‌شود و هیچ اطلاعات شخصی در اختیار تیم‌های نشریه قرار نمی‌گیرد. تیم‌ها فقط آمار تجمیعی نشریهٔ خود را می‌بینند. می‌توانید هر زمان حساب خود را از بخش تنظیمات حذف کنید.</p>
      </section>
      <p className="text-muted">
        <Link to="/" className="underline">
          بازگشت به خانه
        </Link>
      </p>
    </article>
  )
}

const GUIDE: { id: string; title: string; steps: string[] }[] = [
  {
    id: 'student',
    title: 'دانشجو و خواننده',
    steps: [
      'از «ثبت‌نام» با شمارهٔ دانشجویی حساب بسازید؛ مهمان‌ها هم می‌توانند شماره‌های رایگان را بخوانند.',
      'در «اکسپلور» پست‌های تصویری نشریات را ببینید و با «خواندن کامل» به صفحهٔ شماره بروید.',
      'نشریه‌های دلخواه را «دنبال» کنید تا شماره‌ها و استوری‌های تازه در خانه و اعلان‌ها بیاید.',
      'برای شمارهٔ پولی، کد خرید را در «ثبت کد» وارد کنید (یا QR روی کارت کد را اسکن کنید)؛ شماره برای همیشه به «کتابخانه» افزوده می‌شود.',
      'در کتاب‌خوان: ورق‌زدن با کشیدن یا کلیدهای جهت، فهرست مطالب، نشانک، بزرگ‌نمایی، حالت دوصفحه‌ای (صفحهٔ عریض) و حالت شب.',
      'از «تنظیمات» رمز، پوسته و ورود دومرحله‌ای (TOTP) را مدیریت و نشست‌های فعال را ببینید.'
    ]
  },
  {
    id: 'team',
    title: 'تیم نشریه (مدیرمسئول، سردبیر، صاحب امتیاز)',
    steps: [
      'از منوی کاربری وارد «پنل تیم» شوید؛ اگر عضو چند نشریه‌اید، نشریه را از بالای پنل انتخاب کنید.',
      '«شمارهٔ جدید» بسازید و در اتاق شماره، فهرست مطالب، اعضا و مراحل تولید (تایم‌لاین یا چک‌لیست) را پیش ببرید.',
      'صفحات را بارگذاری کنید، قیمت و تعداد صفحات پیش‌نمایش را تعیین و برای تأیید انتشار بفرستید.',
      'پس از انتشار: QR نسخهٔ چاپی را دریافت کنید، گواهی همکاری صادر کنید و در صورت نشت، کد نامرئی تصویر را «ردیابی» کنید.',
      'در «فروش» کدهای خرید یک‌بارمصرف (با QR) بسازید و فروش چاپی را ثبت کنید.',
      'در «پست‌ها» پست و استوری اکسپلور منتشر و نظرها را بررسی کنید؛ «آمار» روند بازدید و فروش همان نشریه را نشان می‌دهد.'
    ]
  },
  {
    id: 'officer',
    title: 'مسئول نشریات و ناظر دانشکده',
    steps: [
      '«داشبورد» نمای کلی، بینش‌های خودکار (شمارهٔ متوقف، مهلت گذشته، نشریهٔ غیرفعال…) و فید زنده را نشان می‌دهد.',
      'شماره‌های منتظر را در «تأیید انتشار» بررسی، تأیید یا برای اصلاح برگردانید.',
      'در «نشریات» پرونده، اعضا، تاریخچهٔ مدیران و وضعیت هر نشریه را ببینید و مدیریت کنید.',
      '«تحلیل‌ها»: روند و مقایسهٔ سال‌به‌سال، رتبه‌بندی سلامت، تولید، فاصلهٔ انتشار، مدیران، قیف اکسپلور ← خواندن ← خرید، فروش و پیش‌بینی پایان ترم.',
      'اطلاعیه، مهلت و فراخوان جذب بفرستید؛ گزارش‌ها و نظرهای گزارش‌شده را در «گزارش‌ها» رسیدگی کنید.',
      'در «تنظیمات» ثبت‌نام، سقف نشست هم‌زمان، آستانه‌های بینش و وزن‌های امتیاز سلامت را تنظیم کنید؛ همهٔ اقدام‌ها در «ممیزی» ثبت می‌شوند.'
    ]
  }
]

/** In-site user guide for each role (ROADMAP phases 4 & 12). */
export function Guide() {
  return (
    <article className="mx-auto max-w-2xl space-y-6 text-sm leading-8">
      <header>
        <h1 className="text-xl font-extrabold">راهنمای کاربری نشریار</h1>
        <nav className="mt-2 flex flex-wrap gap-2" aria-label="نقش‌ها">
          {GUIDE.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="chip">
              {g.title}
            </a>
          ))}
        </nav>
      </header>
      {GUIDE.map((g) => (
        <section key={g.id} id={g.id} className="card scroll-mt-20 p-5">
          <h2 className="mb-2 text-base font-bold">{g.title}</h2>
          <ol className="list-decimal space-y-1 ps-5">
            {g.steps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </section>
      ))}
      <p className="text-muted">
        نسخهٔ چاپی این راهنما: از منوی مرورگر «چاپ ← ذخیره به PDF». ·{' '}
        <Link to="/terms" className="underline">
          قوانین و حریم خصوصی
        </Link>
      </p>
    </article>
  )
}
