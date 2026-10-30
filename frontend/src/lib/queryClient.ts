/**
 * 全局唯一的 TanStack Query 客户端。
 *
 * React 组件（如 /admin 后台）用 useQuery/useMutation 走 React 上下文；
 * 非组件代码（如 editor/serverSync 的镜像层）直接 import 这个实例用
 * queryClient.fetchQuery —— 同一个缓存、同一套去重与重试策略。
 */

import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})
