import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contentApi } from '../api/content';

export function useContentList(tab = 'all') {
  return useQuery({ queryKey: ['content', tab], queryFn: () => contentApi.list(tab) });
}

export function useContentDetail(id: string) {
  return useQuery({ queryKey: ['content', 'detail', id], queryFn: () => contentApi.get(id), enabled: !!id });
}

export function useRenderQueue() {
  return useQuery({ queryKey: ['content', 'render_queue'], queryFn: () => contentApi.renderQueue() });
}

export function useContentUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...updates }: { id: string } & Record<string, any>) => contentApi.update(id, updates),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['content'] }); },
  });
}

export function useBulkApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => contentApi.bulkApprove(ids),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['content'] }); },
  });
}

export function useBulkReject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason: string }) => contentApi.bulkReject(ids, reason),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['content'] }); },
  });
}
