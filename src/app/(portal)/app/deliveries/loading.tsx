import { PageSkeleton } from '@/components/loading-skeleton';

export default function Loading() {
  return <PageSkeleton label="Loading deliveries" rows={6} />;
}
