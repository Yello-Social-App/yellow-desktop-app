import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';

import { ErrorBoundaryOutlet } from '@/components/ErrorBoundary';
import { AppShell } from '@/components/layout/AppShell';
import { GuestRoute } from '@/components/layout/GuestRoute';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { Spinner } from '@/components/ui/Spinner';
import { useSessionLifecycle } from '@/features/auth/hooks';
import { ForgotPasswordPage } from '@/routes/auth/ForgotPasswordPage';
import { LoginPage } from '@/routes/auth/LoginPage';
import { RegisterPage } from '@/routes/auth/RegisterPage';
import { ResetPasswordPage } from '@/routes/auth/ResetPasswordPage';
import { VerifyOtpPage } from '@/routes/auth/VerifyOtpPage';

// Split at the route level: none of these are needed to render the auth flow.
const FeedPage = lazy(() => import('@/routes/feed/FeedPage'));
const PostPage = lazy(() => import('@/routes/feed/PostPage'));
const FriendsPage = lazy(() => import('@/routes/friends/FriendsPage'));
const CommunitiesPage = lazy(() => import('@/routes/communities/CommunitiesPage'));
const CommunityPage = lazy(() => import('@/routes/communities/CommunityPage'));
const ShowcasePage = lazy(() => import('@/routes/showcase/ShowcasePage'));
const ProjectPage = lazy(() => import('@/routes/showcase/ProjectPage'));
const MessagesPage = lazy(() => import('@/routes/messages/MessagesPage'));
const NotificationsPage = lazy(() => import('@/routes/notifications/NotificationsPage'));
const ProfilePage = lazy(() => import('@/routes/profile/ProfilePage'));
const UserProfilePage = lazy(() => import('@/routes/profile/UserProfilePage'));
const SettingsPage = lazy(() => import('@/routes/settings/SettingsPage'));

function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

/**
 * Hash routing: the renderer is served from a custom `app://` scheme with no
 * server-side rewrites, so paths never need to resolve on disk.
 */
export function App() {
  useSessionLifecycle();

  return (
    <HashRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Each tree gets its own boundary, so a failure is contained. */}
          <Route element={<ErrorBoundaryOutlet />}>
            <Route element={<GuestRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/verify" element={<VerifyOtpPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
            </Route>
          </Route>

          <Route element={<ErrorBoundaryOutlet />}>
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route path="/feed" element={<FeedPage />} />
                <Route path="/posts/:postId" element={<PostPage />} />
                <Route path="/messages" element={<MessagesPage />} />
                <Route path="/messages/:conversationId" element={<MessagesPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/friends" element={<FriendsPage />} />
                <Route path="/communities" element={<CommunitiesPage />} />
                <Route path="/c/:slug" element={<CommunityPage />} />
                <Route path="/showcase" element={<ShowcasePage />} />
                <Route path="/showcase/:projectId" element={<ProjectPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/users/:userId" element={<UserProfilePage />} />
                <Route path="/settings" element={<Navigate to="/settings/appearance" replace />} />
                <Route path="/settings/:section" element={<SettingsPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/feed" replace />} />
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
