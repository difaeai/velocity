/**
 * The crew page became the Employees page when the crew became named people you
 * hire. This route stays behind so an old bookmark — or an old link in a page
 * nobody remembered to update — lands on the team rather than on a 404.
 */
import { redirect } from 'next/navigation';

export default function CrewPage() {
  redirect('/dashboard/social/employees');
}
