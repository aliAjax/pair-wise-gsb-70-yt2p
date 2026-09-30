import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { useRepositorySync } from './services/repository-sync';

export function AppRoot() {
  useRepositorySync();
  return <RouterProvider router={router} />;
}
