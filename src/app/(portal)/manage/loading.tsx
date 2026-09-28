import { PageSkeleton } from '@/components/loading-skeleton';

export default function Loading() {
  return <PageSkeleton label="Loading the site" stats={3} />;
}
