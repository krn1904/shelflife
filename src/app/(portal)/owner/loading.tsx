import { PageSkeleton } from '@/components/loading-skeleton';

export default function Loading() {
  return <PageSkeleton label="Loading the group" stats={3} />;
}
