'use client';
import { usePathname } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { currentTab, billingTabs } from '@/lib/nav';
import { TabBar } from '@/components/ui/TabBar';

interface Me { role: string | null; isAdmin: boolean }

/** The tab bar shared by every billing page. */
export function BillingTabs() {
  const path = usePathname();
  const me = useApi<Me>('/me');
  if (!me.data?.role) return null;
  const tabs = billingTabs(me.data.role, me.data.isAdmin);
  if (tabs.length === 0) return null;
  return <TabBar label="Billing sections" tabs={tabs} current={currentTab(tabs, path)} />;
}
