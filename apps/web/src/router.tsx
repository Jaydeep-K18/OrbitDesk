import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppLayout } from '@/components/layout/app-layout';
import { NotFoundPage, PlaceholderPage } from '@/pages/placeholder-page';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: (
          <PlaceholderPage
            title="Overview"
            description="Current session, today's focus time, blocked attempts, tasks and insights."
          />
        ),
      },
      {
        path: 'tasks',
        element: <PlaceholderPage title="Tasks" description="Create and organise your tasks." />,
      },
      {
        path: 'sessions',
        element: (
          <PlaceholderPage title="Sessions" description="Plan, start and review focus sessions." />
        ),
      },
      {
        path: 'analytics',
        element: (
          <PlaceholderPage title="Analytics" description="Focus trends, domains and heatmaps." />
        ),
      },
      {
        path: 'domains',
        element: (
          <PlaceholderPage title="Domains" description="Always-block and always-relevant lists." />
        ),
      },
      {
        path: 'settings',
        element: (
          <PlaceholderPage title="Settings" description="Account, privacy and paired devices." />
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
