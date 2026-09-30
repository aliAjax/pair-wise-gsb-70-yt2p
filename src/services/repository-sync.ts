import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { contractKeys } from './contract-queries';
import { subscribeRepository } from './contract-service';

/** 另一个标签页（另一位评审人）写入 localStorage 后，本页立即重取。 */
export function useRepositorySync() {
  const queryClient = useQueryClient();
  useEffect(
    () => subscribeRepository(() => void queryClient.invalidateQueries({ queryKey: contractKeys.all })),
    [queryClient],
  );
}
