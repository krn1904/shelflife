import { PageSkeleton } from '@/components/loading-skeleton';

// Any portal page without a closer match: shown at once on navigation, before data arrives.
export default function Loading() {
  return <PageSkeleton label="Loading" />;
}
