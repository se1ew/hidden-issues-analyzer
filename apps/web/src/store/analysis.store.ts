import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface AnalysisProgress {
  processed: number;
  total: number;
  step?: string;
  label?: string;
}

interface AnalysisState {
  jobId: string | null;
  progress: AnalysisProgress | null;
  lastError: string | null;
  startJob: (jobId: string) => void;
  updateProgress: (p: Partial<AnalysisProgress>) => void;
  finish: () => void;
  setError: (error: string) => void;
  clearError: () => void;
}

export const useAnalysisStore = create<AnalysisState>()(
  persist(
    (set) => ({
      jobId: null,
      progress: null,
      lastError: null,
      startJob: (jobId) => set({ jobId, progress: { processed: 0, total: 0 }, lastError: null }),
      updateProgress: (p) =>
        set((s) => ({
          progress: s.progress ? { ...s.progress, ...p } : { processed: 0, total: 0, ...p },
        })),
      finish: () => set({ jobId: null, progress: null }),
      setError: (error) => set({ jobId: null, progress: null, lastError: error }),
      clearError: () => set({ lastError: null }),
    }),
    {
      name: 'hia-analysis',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
