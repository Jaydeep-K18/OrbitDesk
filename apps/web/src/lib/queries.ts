import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActiveSessionResponse,
  AnalyticsOverview,
  DashboardSummary,
  Device,
  DomainRule,
  DomainsAnalytics,
  FocusSession,
  HeatmapAnalytics,
  SessionReport,
  SessionsStats,
  Task,
  User,
  UserSettings,
} from '@focusguard/contracts';
import { api } from './api';
import { nudgeExtension } from './extension';

export const qk = {
  me: ['me'] as const,
  settings: ['settings'] as const,
  tasks: (status?: string) => ['tasks', status ?? 'all'] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => ['session', id] as const,
  active: ['sessions', 'active'] as const,
  report: (id: string) => ['report', id] as const,
  dashboard: ['dashboard'] as const,
  domainRules: ['domain-rules'] as const,
  devices: ['devices'] as const,
  analytics: (kind: string, params: object) => ['analytics', kind, params] as const,
};

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Everything that depends on session state, refreshed together after a session mutation. */
export function useInvalidateSessionData() {
  const qc = useQueryClient();
  return async () => {
    nudgeExtension();
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.active }),
      qc.invalidateQueries({ queryKey: qk.sessions }),
      qc.invalidateQueries({ queryKey: qk.dashboard }),
      qc.invalidateQueries({ queryKey: ['session'] }),
      qc.invalidateQueries({ queryKey: ['report'] }),
      qc.invalidateQueries({ queryKey: ['tasks'] }),
    ]);
  };
}

// --- Account ---------------------------------------------------------------
export const useSettings = () =>
  useQuery({ queryKey: qk.settings, queryFn: () => api<UserSettings>('/me/settings') });

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<UserSettings>) =>
      api<UserSettings>('/me/settings', { method: 'PATCH', body }),
    onSuccess: (data) => {
      qc.setQueryData(qk.settings, data);
      nudgeExtension();
    },
  });
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (body: Partial<Pick<User, 'displayName' | 'timezone'>>) =>
      api<User>('/me', { method: 'PATCH', body }),
  });
}

// --- Tasks -----------------------------------------------------------------
export const useTasks = (status?: string) =>
  useQuery({
    queryKey: qk.tasks(status),
    queryFn: () => api<Page<Task>>('/tasks', { query: { status, limit: 100 } }),
  });

export function useTaskMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) => api<Task>('/tasks', { method: 'POST', body }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
        api<Task>(`/tasks/${id}`, { method: 'PATCH', body }),
      // Optimistic status toggle.
      onMutate: async (vars) => {
        await qc.cancelQueries({ queryKey: ['tasks'] });
        const snapshots = qc.getQueriesData<Page<Task>>({ queryKey: ['tasks'] });
        for (const [key, data] of snapshots) {
          if (!data) continue;
          qc.setQueryData<Page<Task>>(key, {
            ...data,
            items: data.items.map((t) => (t.id === vars.id ? ({ ...t, ...vars } as Task) : t)),
          });
        }
        return { snapshots };
      },
      onError: (_e, _v, context) => {
        for (const [key, data] of context?.snapshots ?? []) qc.setQueryData(key, data);
      },
      onSettled: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>(`/tasks/${id}`, { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
  };
}

// --- Domains ---------------------------------------------------------------
export const useDomainRules = () =>
  useQuery({
    queryKey: qk.domainRules,
    queryFn: () => api<{ items: DomainRule[] }>('/domain-rules'),
  });

export function useDomainRuleMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.domainRules });
  return {
    add: useMutation({
      mutationFn: (body: { domain: string; list: DomainRule['list'] }) =>
        api<DomainRule>('/domain-rules', { method: 'POST', body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>(`/domain-rules/${id}`, { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
    preset: useMutation({
      mutationFn: (presetId: string) =>
        api<{ added: number; skipped: number }>(`/domain-rules/presets/${presetId}`, {
          method: 'POST',
        }),
      onSuccess: invalidate,
    }),
  };
}

// --- Sessions --------------------------------------------------------------
/** Polled every 15 s in Phase 1 (Socket.IO replaces polling in Phase 3). */
export const useActiveSession = () =>
  useQuery({
    queryKey: qk.active,
    queryFn: () => api<ActiveSessionResponse>('/sessions/active'),
    refetchInterval: 15_000,
  });

export const useSessions = () =>
  useQuery({
    queryKey: qk.sessions,
    queryFn: () => api<Page<FocusSession>>('/sessions', { query: { limit: 50 } }),
  });

export const useSession = (id: string) =>
  useQuery({ queryKey: qk.session(id), queryFn: () => api<FocusSession>(`/sessions/${id}`) });

export function useSessionMutations() {
  const invalidate = useInvalidateSessionData();
  const opts = { onSuccess: invalidate };
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        api<FocusSession>('/sessions', { method: 'POST', body }),
      ...opts,
    }),
    end: useMutation({
      mutationFn: ({ id, version, reason }: { id: string; version: number; reason?: string }) =>
        api<FocusSession>(`/sessions/${id}/end`, {
          method: 'POST',
          body: { expectedVersion: version, confirm: true, reason },
        }),
      ...opts,
    }),
    extend: useMutation({
      mutationFn: ({ id, version, minutes }: { id: string; version: number; minutes: number }) =>
        api<FocusSession>(`/sessions/${id}/extend`, {
          method: 'POST',
          body: { expectedVersion: version, minutes },
        }),
      ...opts,
    }),
    start: useMutation({
      mutationFn: ({ id, version }: { id: string; version: number }) =>
        api<FocusSession>(`/sessions/${id}/start`, {
          method: 'POST',
          body: { expectedVersion: version },
        }),
      ...opts,
    }),
    cancel: useMutation({
      mutationFn: ({ id, version }: { id: string; version: number }) =>
        api<FocusSession>(`/sessions/${id}/cancel`, {
          method: 'POST',
          body: { expectedVersion: version },
        }),
      ...opts,
    }),
    toggleTask: useMutation({
      mutationFn: ({
        sessionId,
        sessionTaskId,
        completed,
      }: {
        sessionId: string;
        sessionTaskId: string;
        completed: boolean;
      }) =>
        api<FocusSession>(`/sessions/${sessionId}/tasks/${sessionTaskId}`, {
          method: 'PATCH',
          body: { completed },
        }),
      ...opts,
    }),
    addDomain: useMutation({
      mutationFn: ({
        id,
        domain,
        kind,
      }: {
        id: string;
        domain: string;
        kind: 'blocked' | 'relevant';
      }) =>
        api<FocusSession>(`/sessions/${id}/domains`, { method: 'POST', body: { domain, kind } }),
      ...opts,
    }),
  };
}

// --- Reports, dashboard & analytics ----------------------------------------
export const useReport = (id: string) =>
  useQuery({
    queryKey: qk.report(id),
    queryFn: () => api<SessionReport>(`/sessions/${id}/report`),
  });

export function useRelabel(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      segmentId,
      label,
      applyToFuture,
    }: {
      segmentId: string;
      label: string;
      applyToFuture: boolean;
    }) =>
      api(`/activity/segments/${segmentId}/label`, {
        method: 'PATCH',
        body: { label, applyToFuture },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.report(sessionId) });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export const useDashboard = () =>
  useQuery({
    queryKey: qk.dashboard,
    queryFn: () => api<DashboardSummary>('/dashboard/summary'),
    refetchInterval: 15_000,
  });

export const useOverview = (params: { from: string; to: string; granularity: 'day' | 'week' }) =>
  useQuery({
    queryKey: qk.analytics('overview', params),
    queryFn: () => api<AnalyticsOverview>('/analytics/overview', { query: params }),
  });

export const useDomainsAnalytics = (params: { from: string; to: string }) =>
  useQuery({
    queryKey: qk.analytics('domains', params),
    queryFn: () => api<DomainsAnalytics>('/analytics/domains', { query: { ...params, limit: 8 } }),
  });

export const useHeatmap = (params: { from: string; to: string }) =>
  useQuery({
    queryKey: qk.analytics('heatmap', params),
    queryFn: () => api<HeatmapAnalytics>('/analytics/heatmap', { query: params }),
  });

export const useSessionsStats = (params: { from: string; to: string }) =>
  useQuery({
    queryKey: qk.analytics('sessions-stats', params),
    queryFn: () => api<SessionsStats>('/analytics/sessions-stats', { query: params }),
  });

// --- Devices ---------------------------------------------------------------
export const useDevices = () =>
  useQuery({ queryKey: qk.devices, queryFn: () => api<{ items: Device[] }>('/devices') });
