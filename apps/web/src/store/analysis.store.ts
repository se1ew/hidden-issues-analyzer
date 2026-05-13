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
  startJob: (jobId: string) => void;
  updateProgress: (p: Partial<AnalysisProgress>) => void;
  finish: () => void;
}

export const useAnalysisStore = create<AnalysisState>()(
  persist(
    (set) => ({
      jobId: null,
      progress: null,
      startJob: (jobId) => set({ jobId, progress: { processed: 0, total: 0 } }),
      updateProgress: (p) =>
        set((s) => ({
          progress: s.progress ? { ...s.progress, ...p } : { processed: 0, total: 0, ...p },
        })),
      finish: () => set({ jobId: null, progress: null }),
    }),
    {
      name: 'hia-analysis',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
