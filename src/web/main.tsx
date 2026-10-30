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

// Team panel: separate chunks, only downloaded by team members.
const TeamLayout = lazy(() => import('./team/Layout'))
const TeamSelect = lazy(() => import('./team/Layout').then((m) => ({ default: m.TeamSelect })))
const TeamDashboard = lazy(() => import('./team/Dashboard'))
const TeamIssues = lazy(() => import('./team/Issues'))
const IssueNew = lazy(() => import('./team/IssueNew'))
const IssueRoom = lazy(() => import('./team/IssueRoom'))
const TeamMembers = lazy(() => import('./team/Members'))
const TeamPosts = lazy(() => import('./team/Posts'))
const TeamComments = lazy(() => import('./team/Comments'))
const TeamSales = lazy(() => import('./team/Sales'))
const TeamStats = lazy(() => import('./team/Stats'))
const TeamRecruit = lazy(() => import('./team/Recruit'))
const TeamProfile = lazy(() => import('./team/Profile'))

if (getLargeText()) setLargeText(true)

function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* full-screen reader, outside the chrome */}
        <Route path="/read/:id" element={<Reader />} />
        <Route path="/team" element={<TeamSelect />} />
        <Route path="/team/:pubId" element={<TeamLayout />}>
          <Route index element={<TeamDashboard />} />
          <Route path="issues" element={<TeamIssues />} />
          <Route path="issues/new" element={<IssueNew />} />
          <Route path="issues/:issueId" element={<IssueRoom />} />
          <Route path="members" element={<TeamMembers />} />
          <Route path="posts" element={<TeamPosts />} />
          <Route path="comments" element={<TeamComments />} />
          <Route path="sales" element={<TeamSales />} />
          <Route path="stats" element={<TeamStats />} />
          <Route path="recruit" element={<TeamRecruit />} />
          <Route path="profile" element={<TeamProfile />} />
          <Route path="*" element={<NotFound />} />
        </Route>
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
