import { create } from 'zustand';
import type { AnalysisRunItem } from '../lib/queries';

export interface AnalysisProgress { processed: number; total: number; step?: string; label?: string }
interface AnalysisState {
  jobId: string | null; progress: AnalysisProgress | null; lastError: string | null;
  selectedRunId: string | null; runVersion: number;
  startJob: (jobId: string) => void;
  updateProgress: (progress: Partial<AnalysisProgress>) => void;
  syncRun: (run: AnalysisRunItem | null) => void;
  finish: () => void; setError: (error: string) => void; clearError: () => void; clear: () => void;
}
try { sessionStorage.removeItem('hia-analysis'); } catch { /* Session storage may be unavailable. */ }
const empty = { jobId: null, progress: null, lastError: null, selectedRunId: null, runVersion: -1 };
export const useAnalysisStore = create<AnalysisState>((set) => ({
  ...empty,
  startJob: (jobId) => set({ jobId, selectedRunId: jobId, runVersion: -1,
    progress: { processed: 0, total: 0 }, lastError: null }),
  updateProgress: (progress) => set((state) => ({
    progress: state.progress ? { ...state.progress, ...progress } : { processed: 0, total: 0, ...progress },
  })),
  syncRun: (run) => set((state) => {
    if (!run) return empty;
    if (state.selectedRunId === run.id && run.stateVersion < state.runVersion) return state;
    const active = run.status === 'queued' || run.status === 'running';
    return { selectedRunId: run.id, runVersion: run.stateVersion,
      jobId: active ? run.id : null,
      progress: active ? { processed: run.processed, total: run.total, step: run.stage,
        label: run.cancelRequestedAt ? 'Останавливается' : run.status === 'queued' ? 'В очереди' : 'Извлечение аспектов' } : null,
      lastError: ['partial', 'failed', 'interrupted'].includes(run.status)
        ? run.finishReason === 'grouping_pending' ? 'Извлечение сохранено; группы проблем пока недоступны'
          : 'Обработка завершилась не полностью: ошибок ' + run.failed + ', осталось ' + run.remaining
        : null,
    };
  }),
  finish: () => set({ jobId: null, progress: null }),
  setError: (lastError) => set({ jobId: null, progress: null, lastError }),
  clearError: () => set({ lastError: null }),
  clear: () => set(empty),
}));
