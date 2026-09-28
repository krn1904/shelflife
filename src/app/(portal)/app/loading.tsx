import { PageSkeleton } from '@/components/loading-skeleton';

export default function Loading() {
  return <PageSkeleton label="Loading your shift" stats={3} />;
}
