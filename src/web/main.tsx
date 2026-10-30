import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './styles.css'
import { AuthProvider } from './lib/auth'
import { getLargeText, setLargeText } from './lib/theme'
import { PageLoader, ToastProvider } from './components/ui'
import PublicLayout from './public/Layout'
import Home from './public/Home'
import { NotFound, Terms } from './public/Static'

// Public pages: lazily loaded to keep the first paint small.
const Explore = lazy(() => import('./public/Explore'))
const Post = lazy(() => import('./public/Post'))
const Categories = lazy(() => import('./public/Categories'))
const Category = lazy(() => import('./public/Category'))
const Search = lazy(() => import('./public/Search'))
const Publication = lazy(() => import('./public/Publication'))
const Issue = lazy(() => import('./public/Issue'))
const Reader = lazy(() => import('./public/Reader'))
const Library = lazy(() => import('./public/Library'))
const Redeem = lazy(() => import('./public/Redeem'))
const Following = lazy(() => import('./public/Following'))
const Notifications = lazy(() => import('./public/Notifications'))
const Login = lazy(() => import('./public/Login'))
const Register = lazy(() => import('./public/Register'))
const Settings = lazy(() => import('./public/Settings'))
const Verify = lazy(() => import('./public/Verify'))
const Recruitment = lazy(() => import('./public/Recruitment'))

if (getLargeText()) setLargeText(true)

function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* full-screen reader, outside the chrome */}
        <Route path="/read/:id" element={<Reader />} />
        <Route element={<PublicLayout />}>
          <Route index element={<Home />} />
          <Route path="explore" element={<Explore />} />
          <Route path="post/:id" element={<Post />} />
          <Route path="categories" element={<Categories />} />
          <Route path="c/:slug" element={<Category />} />
          <Route path="faculty/:id" element={<Category kind="faculty" />} />
          <Route path="search" element={<Search />} />
          <Route path="p/:slug" element={<Publication />} />
          <Route path="issue/:id" element={<Issue />} />
          <Route path="library" element={<Library />} />
          <Route path="redeem" element={<Redeem />} />
          <Route path="following" element={<Following />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="settings" element={<Settings />} />
          <Route path="verify" element={<Verify />} />
          <Route path="verify/:code" element={<Verify />} />
          <Route path="recruitment" element={<Recruitment />} />
          <Route path="terms" element={<Terms />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
