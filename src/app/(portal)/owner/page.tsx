import { redirect } from 'next/navigation';

export default async function OwnerPage() {
  redirect('/manage');
}
