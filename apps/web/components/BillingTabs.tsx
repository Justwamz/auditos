'use client';
import { usePathname } from 'next/navigation';
import { useMe } from '@/components/Me';
import { billingTabs, currentTab, shownTabs } from '@/lib/nav';
import { TabBar } from '@/components/ui/TabBar';

/** The tab bar shared by every billing page. */
export function BillingTabs() {
  const path = usePathname();
  const me = useMe();
  const tabs = billingTabs(me.role, me.isAdmin);
  if (!shownTabs(tabs)) return null;
  return <TabBar label="Billing sections" tabs={tabs} current={currentTab(tabs, path)} />;
}
