import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

// ===== Types =====

export interface OverviewStats {
  total: number;
  analyzed: number;
  pending: number;
  avgRating: number | null;
  sentiment: { positive: number; negative: number; neutral: number };
  negativePct: number;
  issuesCount: number;
}

export interface TimeseriesBucket {
  date: string;
  positive: number;
  negative: number;
  neutral: number;
}

export interface ReviewListItem {
  id: string;
  text: string;
  rating: number | null;
  sentiment: 'positive' | 'negative' | 'neutral' | null;
  sentimentScore: number | null;
  issues: string[] | null;
  aspects: Array<{ name: string; sentiment: string }> | null;
  hiddenIssueId: string | null;
  analyzedAt: string | null;
  createdAt: string;
}

export interface ReviewsListResponse {
  items: ReviewListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface HiddenIssue {
  id: string;
  title: string;
  description: string | null;
  keywords: string[] | null;
  size: number;
  severity: number;
  visibility: number;
  hiddenScore: number;
  createdAt: string;
}

export interface ReportItem {
  id: string;
  title: string;
  format: 'pdf' | 'docx';
  filePath: string;
  createdAt: string;
}

// ===== Reviews =====

export function useReviews(params: {
  page: number;
  pageSize: number;
  sentiment?: string;
  rating?: number;
  hasIssues?: boolean;
  search?: string;
}) {
  return useQuery({
    queryKey: ['reviews', params],
    queryFn: async () => {
      const { data } = await api.get<ReviewsListResponse>('/api/reviews', { params });
      return data;
    },
  });
}

export function useUploadCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post<{ count: number; batchId: string }>(
        '/api/reviews/upload/csv',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

export function useCreateManualReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { text: string; rating?: number; productName?: string }) => {
      const { data } = await api.post<{ id: string }>('/api/reviews/upload/text', input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

// ===== Analysis =====

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: async () => {
      const { data } = await api.get<OverviewStats>('/api/analysis/stats');
      return data;
    },
  });
}

export function useTimeseries(params: { bucket?: 'day' | 'week' | 'month'; days?: number } = {}) {
  return useQuery({
    queryKey: ['timeseries', params],
    queryFn: async () => {
      const { data } = await api.get<{ buckets: TimeseriesBucket[] }>('/api/analysis/timeseries', {
        params,
      });
      return data;
    },
  });
}

export function useRunAnalysis() {
  return useMutation({
    mutationFn: async (limit?: number) => {
      const { data } = await api.post<{ jobId: string }>('/api/analysis/run', { limit });
      return data;
    },
  });
}

// ===== Issues =====

export function useHiddenIssues() {
  return useQuery({
    queryKey: ['issues'],
    queryFn: async () => {
      const { data } = await api.get<{ items: HiddenIssue[] }>('/api/issues');
      return data;
    },
  });
}

export function useRecomputeIssues() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{
        clustersCreated: number;
        reviewsAssigned: number;
        noisePoints: number;
      }>('/api/issues/recompute');
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}

// ===== Reports =====

export function useReports() {
  return useQuery({
    queryKey: ['reports'],
    queryFn: async () => {
      const { data } = await api.get<{ items: ReportItem[] }>('/api/reports');
      return data;
    },
  });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { format: 'pdf' | 'docx'; title?: string }) => {
      const { data } = await api.post<{ id: string; downloadUrl: string }>(
        '/api/reports/generate',
        input,
      );
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });
}

// ===== Parsing =====

export function useStartParsing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (url: string) => {
      const { data } = await api.post<{ source: string; reviewsAdded: number }>(
        '/api/parsing/start',
        { url },
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}

// ===== Profile =====

export function useProfileStats() {
  return useQuery({
    queryKey: ['profile', 'stats'],
    queryFn: async () => {
      const { data } = await api.get<{ uploads: number; reports: number }>('/api/profile/stats');
      return data;
    },
  });
}
